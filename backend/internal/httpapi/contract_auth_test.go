package httpapi

import (
	"encoding/json"
	"net/http"
	"testing"
)

// TestContractForSignInAndProfiles runs the real flows through the router and
// checks every response against contracts/openapi.yaml.
func TestContractForSignInAndProfiles(t *testing.T) {
	doc := loadContract(t)
	f := newAuthFixture(t)
	h := f.h
	jsonHeaders := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT}

	// Send a code. The response matches SendCodeAccepted.
	sent := exchange(t, doc, http.MethodPost, "/v1/auth/otp", "/v1/auth/otp", h,
		`{"email":"contract@example.test"}`, jsonHeaders, nil, http.StatusAccepted)
	var accepted struct {
		ChallengeID string `json:"challengeId"`
	}
	if err := json.Unmarshal(sent.Body.Bytes(), &accepted); err != nil {
		t.Fatal(err)
	}
	code := f.mail.lastCode(t)

	// Verify the code. The response matches UserResponse and sets the cookie.
	verified := exchange(t, doc, http.MethodPost, "/v1/auth/otp/verify", "/v1/auth/otp/verify", h,
		`{"challengeId":"`+accepted.ChallengeID+`","code":"`+code+`"}`, jsonHeaders, nil, http.StatusOK)
	var cookie *http.Cookie
	for _, c := range verified.Result().Cookies() {
		cookie = c
	}
	if cookie == nil {
		t.Fatal("verify did not set a cookie")
	}

	// The current session matches CurrentSessionResponse.
	sessionRec := exchange(t, doc, http.MethodGet, "/v1/auth/session", "/v1/auth/session", h, "", nil, cookie, http.StatusOK)
	var session struct {
		CSRFToken string `json:"csrfToken"`
	}
	if err := json.Unmarshal(sessionRec.Body.Bytes(), &session); err != nil {
		t.Fatal(err)
	}
	writeHeaders := map[string]string{"Origin": testOrigin, "Content-Type": jsonCT, CSRFHeader: session.CSRFToken}

	// Own profile before setup, then update it. Both match UserResponse.
	exchange(t, doc, http.MethodGet, "/v1/me", "/v1/me", h, "", nil, cookie, http.StatusOK)
	exchange(t, doc, http.MethodPatch, "/v1/me", "/v1/me", h,
		`{"username":"Contract_User","displayName":"Contract","bio":"Hello","avatarUrl":"https://cdn.example.test/a.png"}`,
		writeHeaders, cookie, http.StatusOK)

	// The public profile matches PublicProfile.
	exchange(t, doc, http.MethodGet, "/v1/users/{username}", "/v1/users/contract_user", h, "", nil, cookie, http.StatusOK)

	// Clearing nullable fields is valid under the contract.
	exchange(t, doc, http.MethodPatch, "/v1/me", "/v1/me", h,
		`{"bio":null,"avatarUrl":null}`, writeHeaders, cookie, http.StatusOK)

	// Error responses are Problem Details under the contract.
	exchange(t, doc, http.MethodGet, "/v1/auth/session", "/v1/auth/session", h, "", nil, nil, http.StatusUnauthorized)
	exchange(t, doc, http.MethodPatch, "/v1/me", "/v1/me", h,
		`{"username":"ab"}`, writeHeaders, cookie, http.StatusBadRequest)
	exchange(t, doc, http.MethodPost, "/v1/auth/otp", "/v1/auth/otp", h,
		`{"email":"contract@example.test"}`, jsonHeaders, nil, http.StatusTooManyRequests)

	// Sign out has no body.
	exchange(t, doc, http.MethodPost, "/v1/auth/logout", "/v1/auth/logout", h, "", writeHeaders, cookie, http.StatusNoContent)
}
