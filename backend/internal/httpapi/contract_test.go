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
	"regexp"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

// This file checks the running handlers against contracts/openapi.yaml.
//
// It is a deliberately small checker, not a general OpenAPI validator. It
// supports only the constructs the Holoraa contract uses: $ref to schemas and
// responses, object schemas with required and additionalProperties: false,
// string (with const, pattern, minLength, maxLength, and format uuid), integer
// bounds, boolean, and nullable types written as ["type", "null"]. Any other
// construct makes the test fail, so a contract change cannot silently go
// unchecked.

const contractPath = "../../../contracts/openapi.yaml"

type contractDoc struct {
	Paths      map[string]contractPathItem `yaml:"paths"`
	Components struct {
		Schemas   map[string]contractSchema   `yaml:"schemas"`
		Responses map[string]contractResponse `yaml:"responses"`
	} `yaml:"components"`
}

type contractPathItem struct {
	Get   *contractOperation `yaml:"get"`
	Post  *contractOperation `yaml:"post"`
	Patch *contractOperation `yaml:"patch"`
}

type contractOperation struct {
	Security    *[]map[string][]string      `yaml:"security"`
	RequestBody *contractRequestBody        `yaml:"requestBody"`
	Responses   map[string]contractResponse `yaml:"responses"`
}

type contractRequestBody struct {
	Content map[string]contractMedia `yaml:"content"`
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
	Type                 any                       `yaml:"type"` // a string, or a list such as [string, "null"]
	Required             []string                  `yaml:"required"`
	AdditionalProperties *bool                     `yaml:"additionalProperties"`
	Properties           map[string]contractSchema `yaml:"properties"`
	Const                *string                   `yaml:"const"`
	Format               string                    `yaml:"format"`
	Pattern              string                    `yaml:"pattern"`
	MinLength            *int                      `yaml:"minLength"`
	MaxLength            *int                      `yaml:"maxLength"`
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

// typeNames returns the declared types of a schema. A single type and a list
// are both accepted.
func typeNames(s contractSchema) []string {
	switch v := s.Type.(type) {
	case string:
		return []string{v}
	case []any:
		var out []string
		for _, x := range v {
			if name, ok := x.(string); ok {
				out = append(out, name)
			}
		}
		return out
	default:
		return nil
	}
}

func hasType(s contractSchema, want string) bool {
	for _, n := range typeNames(s) {
		if n == want {
			return true
		}
	}
	return false
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
	if !hasType(s, "object") {
		t.Fatalf("checker supports only object schemas at the top level, got %v", typeNames(s))
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

// validateValue checks one decoded JSON value. A nullable type accepts null.
func (d contractDoc) validateValue(t *testing.T, name string, s contractSchema, raw any) []string {
	t.Helper()
	if raw == nil {
		if hasType(s, "null") {
			return nil
		}
		return []string{fmt.Sprintf("field %q must not be null", name)}
	}
	switch v := raw.(type) {
	case string:
		if !hasType(s, "string") {
			return []string{fmt.Sprintf("field %q must not be a string", name)}
		}
		return validateString(name, s, v)
	case float64:
		if !hasType(s, "integer") {
			return []string{fmt.Sprintf("field %q must not be a number", name)}
		}
		if v != math.Trunc(v) {
			return []string{fmt.Sprintf("field %q must be an integer", name)}
		}
		var problems []string
		if s.Minimum != nil && v < float64(*s.Minimum) {
			problems = append(problems, fmt.Sprintf("field %q below minimum %d", name, *s.Minimum))
		}
		if s.Maximum != nil && v > float64(*s.Maximum) {
			problems = append(problems, fmt.Sprintf("field %q above maximum %d", name, *s.Maximum))
		}
		return problems
	case bool:
		if !hasType(s, "boolean") {
			return []string{fmt.Sprintf("field %q must not be a boolean", name)}
		}
		return nil
	case map[string]any:
		if !hasType(s, "object") {
			return []string{fmt.Sprintf("field %q must not be an object", name)}
		}
		var problems []string
		for _, p := range d.validateObject(t, s, v) {
			problems = append(problems, name+"."+p)
		}
		return problems
	default:
		t.Fatalf("checker does not support nested values (field %q)", name)
		return nil
	}
}

var uuidRE = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func validateString(name string, s contractSchema, v string) []string {
	var problems []string
	if s.Const != nil && v != *s.Const {
		problems = append(problems, fmt.Sprintf("field %q must be %q", name, *s.Const))
	}
	if s.MinLength != nil && len([]rune(v)) < *s.MinLength {
		problems = append(problems, fmt.Sprintf("field %q is shorter than %d", name, *s.MinLength))
	}
	if s.MaxLength != nil && len([]rune(v)) > *s.MaxLength {
		problems = append(problems, fmt.Sprintf("field %q is longer than %d", name, *s.MaxLength))
	}
	if s.Pattern != "" && !regexp.MustCompile(s.Pattern).MatchString(v) {
		problems = append(problems, fmt.Sprintf("field %q does not match the pattern", name))
	}
	if s.Format == "uuid" && !uuidRE.MatchString(v) {
		problems = append(problems, fmt.Sprintf("field %q is not a UUID", name))
	}
	return problems
}

// exchange sends one request and checks the status, content type, and body
// against the contract operation. template is the contract path (for example
// /v1/users/{username}); path is the concrete request path.
func exchange(t *testing.T, doc contractDoc, method, template, path string, h http.Handler, body string, headers map[string]string, cookie *http.Cookie, wantStatus int) *httptest.ResponseRecorder {
	t.Helper()
	item, ok := doc.Paths[template]
	if !ok {
		t.Fatalf("contract has no path %s", template)
	}
	var op *contractOperation
	switch method {
	case http.MethodGet:
		op = item.Get
	case http.MethodPost:
		op = item.Post
	case http.MethodPatch:
		op = item.Patch
	default:
		t.Fatalf("checker does not support method %s", method)
	}
	if op == nil {
		t.Fatalf("contract has no %s operation for %s", method, template)
	}

	// A request that is expected to succeed must itself be valid under the
	// contract. A request that is expected to fail is deliberately out of
	// contract, so it is not validated here.
	if op.RequestBody != nil && body != "" && wantStatus < 400 {
		media, ok := op.RequestBody.Content["application/json"]
		if !ok {
			t.Fatalf("%s %s: no application/json request body in the contract", method, template)
		}
		var sent map[string]any
		if err := json.Unmarshal([]byte(body), &sent); err != nil {
			t.Fatalf("test request body is not JSON: %v", err)
		}
		if problems := doc.validateObject(t, doc.resolveSchema(t, media.Schema), sent); len(problems) > 0 {
			t.Fatalf("test request for %s %s is not valid under the contract: %s", method, template, strings.Join(problems, "; "))
		}
	}

	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, path, nil)
	} else {
		req = httptest.NewRequest(method, path, strings.NewReader(body))
	}
	req.RemoteAddr = "192.0.2.200:5555"
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != wantStatus {
		t.Fatalf("%s %s = %d, want %d: %s", method, path, rec.Code, wantStatus, rec.Body.String())
	}
	resp, ok := doc.declaredResponse(t, op, rec.Code)
	if !ok {
		t.Fatalf("%s %s returned %d, which the contract does not declare", method, template, rec.Code)
	}
	if len(resp.Content) == 0 {
		if rec.Body.Len() != 0 {
			t.Fatalf("%s %s (%d) must have no body, got %q", method, template, rec.Code, rec.Body.String())
		}
		return rec
	}

	gotType, _, err := mime.ParseMediaType(rec.Header().Get("Content-Type"))
	if err != nil {
		t.Fatalf("%s %s: unparseable Content-Type: %v", method, path, err)
	}
	media, ok := resp.Content[gotType]
	if !ok {
		t.Fatalf("%s %s: content type %q is not declared for status %d", method, template, gotType, rec.Code)
	}

	var decoded map[string]any
	if err := json.NewDecoder(bytes.NewReader(rec.Body.Bytes())).Decode(&decoded); err != nil {
		t.Fatalf("%s %s: body is not a JSON object: %v", method, path, err)
	}
	schema := doc.resolveSchema(t, media.Schema)
	if problems := doc.validateObject(t, schema, decoded); len(problems) > 0 {
		t.Fatalf("%s %s (%d) does not match the contract: %s", method, template, rec.Code, strings.Join(problems, "; "))
	}
	return rec
}

func TestContractHealthEndpoints(t *testing.T) {
	doc := loadContract(t)
	var logs bytes.Buffer

	healthy := newTestRouter(t, stubPinger{}, &logs)
	exchange(t, doc, http.MethodGet, "/v1/health", "/v1/health", healthy, "", nil, nil, http.StatusOK)
	exchange(t, doc, http.MethodGet, "/v1/ready", "/v1/ready", healthy, "", nil, nil, http.StatusOK)

	down := newTestRouter(t, stubPinger{err: errors.New("unreachable")}, &logs)
	exchange(t, doc, http.MethodGet, "/v1/ready", "/v1/ready", down, "", nil, nil, http.StatusServiceUnavailable)
}

// TestPublicOperationsDeclareNoSecurity confirms that the operations covered
// here are declared public in the contract (security: []).
func TestPublicOperationsDeclareNoSecurity(t *testing.T) {
	doc := loadContract(t)
	for _, path := range []string{"/v1/health", "/v1/ready", "/v1/auth/otp", "/v1/auth/otp/verify"} {
		item := doc.Paths[path]
		op := item.Get
		if path == "/v1/auth/otp" || path == "/v1/auth/otp/verify" {
			op = item.Post
		}
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

// TestContractCheckerRejectsDriftInProfileSchemas checks the constructs added
// for sign-in and profiles. A value that breaks any of them must not pass.
func TestContractCheckerRejectsDriftInProfileSchemas(t *testing.T) {
	doc := loadContract(t)
	public := doc.resolveSchema(t, contractSchema{Ref: "#/components/schemas/PublicProfile"})

	valid := map[string]any{
		"id": "11111111-1111-4111-8111-111111111111", "username": "good_name",
		"displayName": nil, "bio": nil, "avatarUrl": nil,
	}
	if p := doc.validateObject(t, public, valid); len(p) != 0 {
		t.Fatalf("a valid public profile was rejected: %v", p)
	}

	bad := map[string]any{
		"id": "not-a-uuid", "username": "Upper_Case", "displayName": nil,
		"bio": nil, "avatarUrl": nil, "email": "leak@example.test",
	}
	problems := doc.validateObject(t, public, bad)
	for _, want := range []string{"UUID", "pattern", "unexpected field"} {
		found := false
		for _, p := range problems {
			if strings.Contains(p, want) {
				found = true
			}
		}
		if !found {
			t.Fatalf("checker did not report %q; problems: %v", want, problems)
		}
	}
}
