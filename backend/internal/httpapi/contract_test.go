package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"mime"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// This file checks the running handlers against contracts/openapi.yaml.
//
// It is a deliberately small checker, not a general OpenAPI validator. It
// supports only the constructs the foundation contract uses: $ref to schemas
// and responses, object schemas with required, additionalProperties: false,
// string const, string type, and integer bounds. Any other construct makes the
// test fail, so a contract change cannot silently go unchecked.

const contractPath = "../../../contracts/openapi.yaml"

type contractDoc struct {
	Paths      map[string]contractPathItem `yaml:"paths"`
	Components struct {
		Schemas   map[string]contractSchema   `yaml:"schemas"`
		Responses map[string]contractResponse `yaml:"responses"`
	} `yaml:"components"`
}

type contractPathItem struct {
	Get *contractOperation `yaml:"get"`
}

type contractOperation struct {
	Security  *[]map[string][]string      `yaml:"security"`
	Responses map[string]contractResponse `yaml:"responses"`
}

type contractResponse struct {
	Ref     string                   `yaml:"$ref"`
	Content map[string]contractMedia `yaml:"content"`
}

type contractMedia struct {
	Schema contractSchema `yaml:"schema"`
}

type contractSchema struct {
	Ref                  string                    `yaml:"$ref"`
	Type                 string                    `yaml:"type"`
	Required             []string                  `yaml:"required"`
	AdditionalProperties *bool                     `yaml:"additionalProperties"`
	Properties           map[string]contractSchema `yaml:"properties"`
	Const                *string                   `yaml:"const"`
	Format               string                    `yaml:"format"`
	Minimum              *int                      `yaml:"minimum"`
	Maximum              *int                      `yaml:"maximum"`
}

func loadContract(t *testing.T) contractDoc {
	t.Helper()
	raw, err := os.ReadFile(filepath.Clean(contractPath))
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}
	var doc contractDoc
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse contract: %v", err)
	}
	return doc
}

// resolveResponse follows a response $ref to components/responses.
func (d contractDoc) resolveResponse(t *testing.T, r contractResponse) contractResponse {
	t.Helper()
	if r.Ref == "" {
		return r
	}
	name, ok := strings.CutPrefix(r.Ref, "#/components/responses/")
	if !ok {
		t.Fatalf("unsupported response $ref %q", r.Ref)
	}
	resolved, ok := d.Components.Responses[name]
	if !ok {
		t.Fatalf("response $ref %q not found", r.Ref)
	}
	return resolved
}

// resolveSchema follows a schema $ref to components/schemas.
func (d contractDoc) resolveSchema(t *testing.T, s contractSchema) contractSchema {
	t.Helper()
	if s.Ref == "" {
		return s
	}
	name, ok := strings.CutPrefix(s.Ref, "#/components/schemas/")
	if !ok {
		t.Fatalf("unsupported schema $ref %q", s.Ref)
	}
	resolved, ok := d.Components.Schemas[name]
	if !ok {
		t.Fatalf("schema $ref %q not found", s.Ref)
	}
	return resolved
}

// declaredResponse returns the contract response for status, or the default.
func (d contractDoc) declaredResponse(t *testing.T, op *contractOperation, status int) (contractResponse, bool) {
	t.Helper()
	if r, ok := op.Responses[fmt.Sprint(status)]; ok {
		return d.resolveResponse(t, r), true
	}
	if r, ok := op.Responses["default"]; ok {
		return d.resolveResponse(t, r), true
	}
	return contractResponse{}, false
}

// validateObject checks a decoded JSON object against an object schema.
func (d contractDoc) validateObject(t *testing.T, s contractSchema, body map[string]any) []string {
	t.Helper()
	var problems []string
	if s.Type != "object" {
		t.Fatalf("checker supports only object schemas at the top level, got %q", s.Type)
	}
	for _, name := range s.Required {
		if _, ok := body[name]; !ok {
			problems = append(problems, fmt.Sprintf("missing required field %q", name))
		}
	}
	if s.AdditionalProperties != nil && !*s.AdditionalProperties {
		for name := range body {
			if _, ok := s.Properties[name]; !ok {
				problems = append(problems, fmt.Sprintf("unexpected field %q", name))
			}
		}
	}
	for name, prop := range s.Properties {
		raw, ok := body[name]
		if !ok {
			continue
		}
		prop = d.resolveSchema(t, prop)
		problems = append(problems, d.validateValue(t, name, prop, raw)...)
	}
	return problems
}

func (d contractDoc) validateValue(t *testing.T, name string, s contractSchema, raw any) []string {
	t.Helper()
	switch s.Type {
	case "string":
		str, ok := raw.(string)
		if !ok {
			return []string{fmt.Sprintf("field %q must be a string", name)}
		}
		if s.Const != nil && str != *s.Const {
			return []string{fmt.Sprintf("field %q must be %q, got %q", name, *s.Const, str)}
		}
	case "integer":
		n, ok := raw.(float64)
		if !ok || n != math.Trunc(n) {
			return []string{fmt.Sprintf("field %q must be an integer", name)}
		}
		if s.Minimum != nil && n < float64(*s.Minimum) {
			return []string{fmt.Sprintf("field %q below minimum %d", name, *s.Minimum)}
		}
		if s.Maximum != nil && n > float64(*s.Maximum) {
			return []string{fmt.Sprintf("field %q above maximum %d", name, *s.Maximum)}
		}
	default:
		t.Fatalf("checker does not support property type %q (field %q)", s.Type, name)
	}
	return nil
}

// checkResponse sends one request, then checks the status, content type, and
// JSON body against the contract.
func checkResponse(t *testing.T, doc contractDoc, path string, h http.Handler, wantStatus int) {
	t.Helper()
	item, ok := doc.Paths[path]
	if !ok || item.Get == nil {
		t.Fatalf("contract has no GET operation for %s", path)
	}
	op := item.Get

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

	if rec.Code != wantStatus {
		t.Fatalf("GET %s = %d, want %d", path, rec.Code, wantStatus)
	}
	resp, ok := doc.declaredResponse(t, op, rec.Code)
	if !ok {
		t.Fatalf("GET %s returned %d, which the contract does not declare", path, rec.Code)
	}

	gotType, _, err := mime.ParseMediaType(rec.Header().Get("Content-Type"))
	if err != nil {
		t.Fatalf("GET %s: unparseable Content-Type: %v", path, err)
	}
	media, ok := resp.Content[gotType]
	if !ok {
		t.Fatalf("GET %s: content type %q is not declared for status %d", path, gotType, rec.Code)
	}

	var body map[string]any
	if err := json.NewDecoder(bytes.NewReader(rec.Body.Bytes())).Decode(&body); err != nil {
		t.Fatalf("GET %s: body is not a JSON object: %v", path, err)
	}

	schema := doc.resolveSchema(t, media.Schema)
	if problems := doc.validateObject(t, schema, body); len(problems) > 0 {
		t.Fatalf("GET %s (%d) does not match the contract: %s", path, rec.Code, strings.Join(problems, "; "))
	}
}

func TestContractHealthEndpoints(t *testing.T) {
	doc := loadContract(t)
	var logs bytes.Buffer

	healthy := newTestRouter(t, stubPinger{}, &logs)
	checkResponse(t, doc, "/v1/health", healthy, http.StatusOK)
	checkResponse(t, doc, "/v1/ready", healthy, http.StatusOK)

	down := newTestRouter(t, stubPinger{err: errors.New("unreachable")}, &logs)
	checkResponse(t, doc, "/v1/ready", down, http.StatusServiceUnavailable)
}

// TestPublicOperationsDeclareNoSecurity confirms that the operations covered
// here are declared public in the contract (security: []).
func TestPublicOperationsDeclareNoSecurity(t *testing.T) {
	doc := loadContract(t)
	for _, path := range []string{"/v1/health", "/v1/ready"} {
		op := doc.Paths[path].Get
		if op == nil || op.Security == nil || len(*op.Security) != 0 {
			t.Fatalf("%s must declare security: [] (public)", path)
		}
	}
}

// TestContractCheckerRejectsDrift makes sure the checker can fail. A body with
// a wrong const value and an extra field must not pass.
func TestContractCheckerRejectsDrift(t *testing.T) {
	doc := loadContract(t)
	live := doc.Paths["/v1/health"].Get.Responses["200"]
	schema := doc.resolveSchema(t, doc.resolveResponse(t, live).Content["application/json"].Schema)

	problems := doc.validateObject(t, schema, map[string]any{"status": "down", "extra": true})
	if len(problems) < 2 {
		t.Fatalf("checker accepted a drifted body; problems: %v", problems)
	}
}
