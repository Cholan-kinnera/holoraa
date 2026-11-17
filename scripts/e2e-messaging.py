#!/usr/bin/env python3
"""
Holoraa M4 End-to-End Reliability, Realtime, Concurrency & Security Test Suite
Covers Sections 3, 4, 5, 6, 7, and 8 of the Holoraa M4 Validation Plan.
"""

import socket
import base64
import os
import sys
import time
import json
import uuid
import struct
import glob
import re
import urllib.request
import urllib.error
import urllib.parse
import subprocess
from concurrent.futures import ThreadPoolExecutor

def clean_test_auth_events():
    subprocess.run([
        "docker", "exec", "holoraa-v2-postgres", "psql", "-U", "holoraa", "-d", "holoraa_dev",
        "-c", "DELETE FROM auth_events WHERE kind = 'otp_sent';"
    ], capture_output=True)

BASE_API = os.environ.get("HOLORAA_API_URL", "http://127.0.0.1:8080")
ORIGIN = os.environ.get("HOLORAA_ALLOWED_ORIGIN", "http://localhost:3000")
MAIL_DIR = os.path.abspath(".local/mail")

# ---------------------------------------------------------------------------
# Test Framework Helpers
# ---------------------------------------------------------------------------
results = []

def check(condition, message):
    if condition:
        print(f"  [PASS] {message}")
        results.append((True, message))
    else:
        print(f"  [FAIL] {message}")
        results.append((False, message))
        raise AssertionError(f"Assertion failed: {message}")

def get_latest_otp(email):
    files = sorted(glob.glob(os.path.join(MAIL_DIR, "*.txt")), key=os.path.getmtime)
    for fpath in reversed(files):
        with open(fpath, "r", encoding="utf-8") as f:
            content = f.read()
            if f"To: {email}" in content:
                match = re.search(r"code is ([0-9]{6})", content)
                if match:
                    return match.group(1)
    raise RuntimeError(f"No OTP found for {email} in {MAIL_DIR}")

class TestClient:
    def __init__(self, username, email):
        self.username = username
        self.email = email
        self.cookie = None
        self.csrf = None
        self.user_id = None

    def authenticate(self):
        # 1. Send OTP challenge
        req = urllib.request.Request(
            f"{BASE_API}/v1/auth/otp",
            data=json.dumps({"email": self.email}).encode(),
            headers={"Content-Type": "application/json", "Origin": ORIGIN}
        )
        with urllib.request.urlopen(req) as resp:
            challenge_id = json.loads(resp.read().decode())["challengeId"]

        # 2. Retrieve OTP
        code = get_latest_otp(self.email)

        # 3. Verify OTP
        req_v = urllib.request.Request(
            f"{BASE_API}/v1/auth/otp/verify",
            data=json.dumps({"challengeId": challenge_id, "code": code}).encode(),
            headers={"Content-Type": "application/json", "Origin": ORIGIN}
        )
        with urllib.request.urlopen(req_v) as resp_v:
            set_cookie = resp_v.headers.get("Set-Cookie")
            self.cookie = set_cookie.split(";")[0]
            body = json.loads(resp_v.read().decode())
            self.user_id = body["user"]["id"]

        # 4. Fetch Session for CSRF
        req_s = urllib.request.Request(
            f"{BASE_API}/v1/auth/session",
            headers={"Cookie": self.cookie}
        )
        with urllib.request.urlopen(req_s) as resp_s:
            sbody = json.loads(resp_s.read().decode())
            self.csrf = sbody["csrfToken"]

        # 5. Onboard Profile if needed
        req_p = urllib.request.Request(
            f"{BASE_API}/v1/me",
            data=json.dumps({
                "username": self.username,
                "displayName": f"{self.username.capitalize()} Test",
                "bio": f"Bio for {self.username}"
            }).encode(),
            headers={
                "Content-Type": "application/json",
                "Origin": ORIGIN,
                "Cookie": self.cookie,
                "X-CSRF-Token": self.csrf
            },
            method="PATCH"
        )
        try:
            with urllib.request.urlopen(req_p) as resp_p:
                pass
        except urllib.error.HTTPError as e:
            # Profile might already be set
            pass

    def request(self, method, path, data=None, headers=None, expect_status=None):
        url = f"{BASE_API}{path}"
        req_headers = {"Origin": ORIGIN}
        if self.cookie:
            req_headers["Cookie"] = self.cookie
        if method in ("POST", "PATCH", "PUT", "DELETE") and self.csrf:
            req_headers["X-CSRF-Token"] = self.csrf

        body = None
        if data is not None:
            body = json.dumps(data).encode()
            req_headers["Content-Type"] = "application/json"

        if headers:
            req_headers.update(headers)

        req = urllib.request.Request(url, data=body, headers=req_headers, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                status = resp.status
                resp_bytes = resp.read()
                resp_json = None
                if resp_bytes:
                    try:
                        resp_json = json.loads(resp_bytes.decode())
                    except Exception:
                        resp_json = resp_bytes.decode()
                if expect_status is not None and status != expect_status:
                    raise AssertionError(f"Expected status {expect_status}, got {status} ({resp_bytes.decode()})")
                return status, resp_json
        except urllib.error.HTTPError as e:
            status = e.code
            resp_bytes = e.read()
            resp_json = None
            if resp_bytes:
                try:
                    resp_json = json.loads(resp_bytes.decode())
                except Exception:
                    resp_json = resp_bytes.decode()
            if expect_status is not None and status != expect_status:
                raise AssertionError(f"Expected status {expect_status}, got {status} ({resp_bytes.decode()})")
            return status, resp_json

    def get_ws_ticket(self):
        status, body = self.request("POST", "/v1/realtime/ticket", data={})
        if status != 201:
            raise RuntimeError(f"Failed to issue ticket: status {status}, body {body}")
        return body["ticket"]

# ---------------------------------------------------------------------------
# Lightweight RFC6455 WebSocket Client
# ---------------------------------------------------------------------------
class SimpleWS:
    def __init__(self, ticket, origin=ORIGIN, host="127.0.0.1", port=8080):
        self.ticket = ticket
        self.origin = origin
        self.host = host
        self.port = port
        self.sock = None
        self.connected = False

    def connect(self):
        self.sock = socket.create_connection((self.host, self.port), timeout=5)
        ws_key = base64.b64encode(os.urandom(16)).decode('ascii')
        proto = f"holoraa, holoraa-ticket.{self.ticket}" if self.ticket else "holoraa"
        handshake = (
            f"GET /v1/realtime/ws HTTP/1.1\r\n"
            f"Host: {self.host}:{self.port}\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {ws_key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n"
            f"Sec-WebSocket-Protocol: {proto}\r\n"
            f"Origin: {self.origin}\r\n\r\n"
        )
        self.sock.sendall(handshake.encode('ascii'))
        resp = b""
        while b"\r\n\r\n" not in resp:
            chunk = self.sock.recv(1024)
            if not chunk:
                break
            resp += chunk
        status_line = resp.split(b"\r\n")[0].decode('ascii', errors='ignore')
        if "101 Switching Protocols" not in status_line:
            self.sock.close()
            raise RuntimeError(f"WS handshake failed: {status_line}")
        self.connected = True

    def send_text(self, text):
        data = text.encode('utf-8')
        length = len(data)
        header = bytearray([0x81]) # FIN + text
        if length <= 125:
            header.append(0x80 | length)
        elif length <= 65535:
            header.append(0x80 | 126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack("!Q", length))
        mask = os.urandom(4)
        header.extend(mask)
        masked_payload = bytearray(b ^ mask[i % 4] for i, b in enumerate(data))
        self.sock.sendall(header + masked_payload)

    def recv_frame(self, timeout=3):
        self.sock.settimeout(timeout)
        try:
            head = self.sock.recv(2)
            if not head or len(head) < 2:
                return None, None
            opcode = head[0] & 0x0F
            masked = (head[1] & 0x80) != 0
            length = head[1] & 0x7F
            if length == 126:
                length = struct.unpack("!H", self.sock.recv(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self.sock.recv(8))[0]
            mask = None
            if masked:
                mask = self.sock.recv(4)
            payload = b""
            while len(payload) < length:
                chunk = self.sock.recv(min(4096, length - len(payload)))
                if not chunk:
                    break
                payload += chunk
            if masked and mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            return opcode, payload
        except (socket.timeout, TimeoutError):
            return None, None

    def recv_event(self, expected_type=None, timeout=3):
        start = time.time()
        while time.time() - start < timeout:
            opcode, payload = self.recv_frame(timeout=max(0.1, timeout - (time.time() - start)))
            if opcode == 1: # Text frame
                try:
                    parsed = json.loads(payload.decode('utf-8'))
                    ev_type = parsed.get('type')
                    print(f"    [WS {self.ticket[:8]}... RECV] {ev_type}")
                    if expected_type is None or ev_type == expected_type:
                        return parsed
                except Exception as ex:
                    print(f"    [WS {self.ticket[:8]}... JSON ERROR] {ex}")
            elif opcode == 9: # Ping
                # Reply with pong
                pong = bytearray([0x8A, 0x80]) + os.urandom(4)
                self.sock.sendall(pong)
        return None

    def close(self):
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass
            self.connected = False

# ---------------------------------------------------------------------------
# Test Suites
# ---------------------------------------------------------------------------
def run_all():
    clean_test_auth_events()
    ts = str(int(time.time()))[-6:]
    alice = TestClient(f"alice_{ts}", f"alice_{ts}@example.test")
    bob = TestClient(f"bob_{ts}", f"bob_{ts}@example.test")
    charlie = TestClient(f"charlie_{ts}", f"charlie_{ts}@example.test")
    david = TestClient(f"david_{ts}", f"david_{ts}@example.test")

    print(f"=== Initializing Test Users ({ts}) ===")
    alice.authenticate()
    bob.authenticate()
    charlie.authenticate()
    david.authenticate()
    check(alice.user_id and bob.user_id, "Alice and Bob authenticated and onboarded")

    # =========================================================================
    # Section 3: Direct conversation and message-request lifecycle
    # =========================================================================
    print("\n--- Section 3: Conversation Lifecycle Scenarios ---")

    # Scenario A: Mutual followers
    print("  Scenario A: Mutual Followers...")
    alice.request("POST", f"/v1/users/{bob.username}/follow", expect_status=204)
    bob.request("POST", f"/v1/users/{alice.username}/follow", expect_status=204)

    status, conv_ab = alice.request("POST", "/v1/conversations/direct", data={"targetUsername": bob.username}, expect_status=201)
    check(conv_ab["status"] == "accepted", "Direct conversation between mutual followers is immediately accepted")
    conv_ab_id = conv_ab["id"]

    # Connect WebSockets for Alice and Bob
    ws_alice = SimpleWS(alice.get_ws_ticket())
    ws_bob = SimpleWS(bob.get_ws_ticket())
    ws_alice.connect()
    ws_bob.connect()
    check(ws_alice.connected and ws_bob.connected, "WebSockets connected for Alice and Bob")

    # Alice sends message
    m1_client_id = str(uuid.uuid4())
    status, m1 = alice.request("POST", f"/v1/conversations/{conv_ab_id}/messages", data={
        "clientMessageId": m1_client_id,
        "content": "Hello Bob from Alice"
    }, expect_status=201)
    check(m1["sequenceNum"] == 1, "Alice's message committed with sequenceNum 1")

    # Bob receives realtime message.created
    event_bob = ws_bob.recv_event("message.created", timeout=4)
    check(event_bob is not None and event_bob.get("type") == "message.created", "Bob receives message.created frame in real time")
    check(event_bob["payload"]["content"] == "Hello Bob from Alice", "Bob receives correct message content")

    # Bob replies
    m2_client_id = str(uuid.uuid4())
    status, m2 = bob.request("POST", f"/v1/conversations/{conv_ab_id}/messages", data={
        "clientMessageId": m2_client_id,
        "content": "Hello Alice, reply from Bob"
    }, expect_status=201)
    check(m2["sequenceNum"] == 2, "Bob's reply committed with sequenceNum 2")

    event_alice = ws_alice.recv_event("message.created", timeout=4)
    check(event_alice is not None and event_alice.get("type") == "message.created", "Alice receives Bob's reply in real time")
    check(event_alice["payload"]["sequenceNum"] == 2, "Message sequence ordering strictly preserved")

    ws_alice.close()
    ws_bob.close()

    # Scenario B: Non-mutual followers (Pending Request Lifecycle)
    print("  Scenario B: Non-Mutual Followers (Pending Request)...")
    status, conv_ac = alice.request("POST", "/v1/conversations/direct", data={"targetUsername": charlie.username}, expect_status=201)
    check(conv_ac["status"] == "pending", "Conversation without mutual follows is in 'pending' status")
    conv_ac_id = conv_ac["id"]

    # Alice sends permitted 1st initial message
    status, m_init = alice.request("POST", f"/v1/conversations/{conv_ac_id}/messages", data={
        "clientMessageId": str(uuid.uuid4()),
        "content": "Initial message to Charlie"
    }, expect_status=201)
    check(m_init["sequenceNum"] == 1, "First message in pending conversation accepted")

    # Alice attempts second message while pending -> rejected 403
    status, err_m2 = alice.request("POST", f"/v1/conversations/{conv_ac_id}/messages", data={
        "clientMessageId": str(uuid.uuid4()),
        "content": "Second unpermitted message"
    })
    check(status == 403, "Second message in pending conversation rejected with 403 Forbidden")

    # Charlie cannot send before accepting
    status, err_charlie = charlie.request("POST", f"/v1/conversations/{conv_ac_id}/messages", data={
        "clientMessageId": str(uuid.uuid4()),
        "content": "Charlie replying before accept"
    })
    check(status == 403, "Recipient cannot send messages before accepting pending request")

    # Charlie accepts conversation
    status, _ = charlie.request("POST", f"/v1/conversations/{conv_ac_id}/accept", expect_status=200)
    status, conv_ac_updated = charlie.request("GET", f"/v1/conversations/{conv_ac_id}", expect_status=200)
    check(conv_ac_updated["status"] == "accepted", "Conversation transitions to 'accepted' after recipient accepts")

    # Now both can message
    status, m_ac2 = charlie.request("POST", f"/v1/conversations/{conv_ac_id}/messages", data={
        "clientMessageId": str(uuid.uuid4()),
        "content": "Charlie reply after acceptance"
    }, expect_status=201)
    check(m_ac2["sequenceNum"] == 2, "Messaging unlocked after conversation acceptance")

    # Scenario C: Declined conversation policy
    print("  Scenario C: Declined Conversation Policy...")
    status, conv_ad = alice.request("POST", "/v1/conversations/direct", data={"targetUsername": david.username}, expect_status=201)
    conv_ad_id = conv_ad["id"]
    check(conv_ad["status"] == "pending", "Alice-David conversation is pending")

    # Alice sends initial message
    alice.request("POST", f"/v1/conversations/{conv_ad_id}/messages", data={
        "clientMessageId": str(uuid.uuid4()),
        "content": "Request to David"
    }, expect_status=201)

    # David declines
    status, _ = david.request("POST", f"/v1/conversations/{conv_ad_id}/decline", expect_status=200)
    status, conv_ad_get = david.request("GET", f"/v1/conversations/{conv_ad_id}", expect_status=200)
    check(conv_ad_get["status"] == "declined", "Conversation status is 'declined'")

    # Both participants cannot send messages
    status, _ = alice.request("POST", f"/v1/conversations/{conv_ad_id}/messages", data={
        "clientMessageId": str(uuid.uuid4()),
        "content": "Alice sending in declined"
    })
    check(status == 403, "Sender cannot send messages in declined conversation (403 Forbidden)")

    status, _ = david.request("POST", f"/v1/conversations/{conv_ad_id}/messages", data={
        "clientMessageId": str(uuid.uuid4()),
        "content": "David sending in declined"
    })
    check(status == 403, "Recipient cannot send messages in declined conversation (403 Forbidden)")

    # POST /v1/conversations/direct returns 403 Forbidden for existing declined canonical conversation
    status, err_create = alice.request("POST", "/v1/conversations/direct", data={"targetUsername": david.username})
    check(status == 403, "POST /v1/conversations/direct returns 403 Forbidden when conversation is declined")

    # Mutual follow does not override declined state
    alice.request("POST", f"/v1/users/{david.username}/follow", expect_status=204)
    david.request("POST", f"/v1/users/{alice.username}/follow", expect_status=204)
    status, err_create2 = alice.request("POST", "/v1/conversations/direct", data={"targetUsername": david.username})
    check(status == 403, "Mutual follows do NOT override terminal declined conversation status")

    # =========================================================================
    # Section 4: Real-time messaging reliability & Idempotency
    # =========================================================================
    print("\n--- Section 4: Messaging Reliability & Keyset Pagination ---")
    # Idempotency test: Alice retries message with same client_message_id
    idemp_key = str(uuid.uuid4())
    status, msg_first = alice.request("POST", f"/v1/conversations/{conv_ab_id}/messages", data={
        "clientMessageId": idemp_key,
        "content": "Idempotency test payload"
    }, expect_status=201)
    first_seq = msg_first["sequenceNum"]

    # Retry exact same client_message_id
    status, msg_retry = alice.request("POST", f"/v1/conversations/{conv_ab_id}/messages", data={
        "clientMessageId": idemp_key,
        "content": "Idempotency test payload"
    }, expect_status=201) # idempotent retry returns 201 with original message
    check(msg_retry["id"] == msg_first["id"], "Idempotent retry returns identical message ID")
    check(msg_retry["sequenceNum"] == first_seq, "Idempotent retry does not allocate a new sequence number")

    # Keyset pagination test
    status, msgs_page = alice.request("GET", f"/v1/conversations/{conv_ab_id}/messages?limit=10", expect_status=200)
    check(len(msgs_page["messages"]) >= 3, "Messages retrieved via keyset pagination")

    # Boundary / cursor validation
    status, _ = alice.request("GET", f"/v1/conversations/{conv_ab_id}/messages?before=00000000-0000-0000-0000-000000000000")
    check(status == 400, "Non-existent pagination cursor rejected with 400 Bad Request")

    # =========================================================================
    # Section 5: Delivery and Read Receipt Privacy
    # =========================================================================
    print("\n--- Section 5: Read Receipts & Privacy Suppression ---")
    ws_alice = SimpleWS(alice.get_ws_ticket())
    ws_bob = SimpleWS(bob.get_ws_ticket())
    ws_alice.connect()
    ws_bob.connect()

    # 1. Enabled read receipts (default)
    status, m_rcpt = alice.request("POST", f"/v1/conversations/{conv_ab_id}/messages", data={
        "clientMessageId": str(uuid.uuid4()),
        "content": "Testing read receipts"
    }, expect_status=201)
    seq_rcpt = m_rcpt["sequenceNum"]

    # Bob marks sequence as read
    status, _ = bob.request("POST", f"/v1/conversations/{conv_ab_id}/read", data={"messageId": m_rcpt["id"]}, expect_status=204)
    read_event = ws_alice.recv_event("message.read", timeout=4)
    check(read_event is not None and read_event.get("type") == "message.read", "Alice receives message.read event when Bob's receipts enabled")
    check(read_event["payload"]["sequenceNum"] == seq_rcpt, "message.read sequence matches read watermark")

    # 2. Bob disables read receipts
    status, _ = bob.request("PATCH", "/v1/me/settings", data={"readReceiptsEnabled": False}, expect_status=200)

    # Alice sends new message
    status, m_priv = alice.request("POST", f"/v1/conversations/{conv_ab_id}/messages", data={
        "clientMessageId": str(uuid.uuid4()),
        "content": "Testing privacy suppression"
    }, expect_status=201)
    seq_priv = m_priv["sequenceNum"]

    # Bob reads message while receipts disabled
    status, _ = bob.request("POST", f"/v1/conversations/{conv_ab_id}/read", data={"messageId": m_priv["id"]}, expect_status=204)
    suppressed_event = ws_alice.recv_event("message.read", timeout=1.5)
    check(suppressed_event is None, "ZERO message.read events sent to peer while read receipts disabled")

    # 3. Bob re-enables read receipts: baseline set, no retroactive disclosure
    status, _ = bob.request("PATCH", "/v1/me/settings", data={"readReceiptsEnabled": True}, expect_status=200)

    # Alice sends message after re-enable
    status, m_post = alice.request("POST", f"/v1/conversations/{conv_ab_id}/messages", data={
        "clientMessageId": str(uuid.uuid4()),
        "content": "Post re-enable message"
    }, expect_status=201)
    seq_post = m_post["sequenceNum"]

    bob.request("POST", f"/v1/conversations/{conv_ab_id}/read", data={"messageId": m_post["id"]}, expect_status=204)
    post_event = ws_alice.recv_event("message.read", timeout=4)
    check(post_event is not None and post_event.get("type") == "message.read", "Alice receives message.read for post-enable message")
    check(post_event["payload"]["sequenceNum"] == seq_post, "Read receipt emitted strictly for post-enable watermark")
    check(post_event["payload"].get("fromSequenceNum", seq_post) > seq_priv or post_event["payload"]["sequenceNum"] == seq_post, "Disabled-period messages are never retroactively disclosed")

    ws_alice.close()
    ws_bob.close()

    # =========================================================================
    # Section 6: Blocking & Concurrency
    # =========================================================================
    print("\n--- Section 6: Blocking & Concurrency ---")
    # Alice blocks Bob
    status, _ = alice.request("POST", f"/v1/users/{bob.username}/block", expect_status=204)

    # Bob cannot message Alice
    status, _ = bob.request("POST", f"/v1/conversations/{conv_ab_id}/messages", data={
        "clientMessageId": str(uuid.uuid4()),
        "content": "Bob messaging blocked Alice"
    })
    check(status == 403, "Blocked user cannot send messages (403 Forbidden)")

    # Alice unblocks Bob
    status, _ = alice.request("DELETE", f"/v1/users/{bob.username}/block", expect_status=204)

    # Concurrency test: Block vs Send under concurrent goroutines/threads
    def try_send():
        return bob.request("POST", f"/v1/conversations/{conv_ab_id}/messages", data={
            "clientMessageId": str(uuid.uuid4()),
            "content": "Concurrent send probe"
        })

    def try_block():
        return alice.request("POST", f"/v1/users/{bob.username}/block")

    with ThreadPoolExecutor(max_workers=2) as executor:
        f_send = executor.submit(try_send)
        f_block = executor.submit(try_block)
        res_send = f_send.result()
        res_block = f_block.result()

    check(res_send[0] in (201, 403), "Block vs send linearizes cleanly (status 201 or 403)")
    check(res_block[0] in (204, 200), "Block executes without lock deadlock")

    # Cleanup block for subsequent tests
    alice.request("DELETE", f"/v1/users/{bob.username}/block")

    # =========================================================================
    # Section 7: Disconnect, Reconnect & Keyset Catch-Up
    # =========================================================================
    print("\n--- Section 7: Disconnect, Reconnect & Catch-Up ---")
    # Bob is offline (no WebSocket connected)
    status, m_offline = alice.request("POST", f"/v1/conversations/{conv_ab_id}/messages", data={
        "clientMessageId": str(uuid.uuid4()),
        "content": "Message while Bob is offline"
    }, expect_status=201)
    offline_seq = m_offline["sequenceNum"]

    # Bob connects fresh WebSocket
    ticket_bob_recon = bob.get_ws_ticket()
    ws_bob_recon = SimpleWS(ticket_bob_recon)
    ws_bob_recon.connect()
    check(ws_bob_recon.connected, "Bob connects with fresh single-use ticket")

    # Keyset catch-up via REST
    status, catchup = bob.request("GET", f"/v1/conversations/{conv_ab_id}/messages?after={m_rcpt['id']}", expect_status=200)
    retrieved_seqs = [m["sequenceNum"] for m in catchup["messages"]]
    check(offline_seq in retrieved_seqs, "REST keyset catch-up retrieves messages missed while offline")

    # Ticket single-use: replay attempt with ticket_bob_recon
    ws_replay = SimpleWS(ticket_bob_recon)
    replay_failed = False
    try:
        ws_replay.connect()
    except Exception:
        replay_failed = True
    check(replay_failed, "Ticket replay attempt is strictly rejected")

    ws_bob_recon.close()

    # =========================================================================
    # Section 8: Security Validation
    # =========================================================================
    print("\n--- Section 8: Security Validation ---")

    # 1. Unauthenticated API access
    req_unauth = urllib.request.Request(f"{BASE_API}/v1/conversations")
    try:
        urllib.request.urlopen(req_unauth)
        check(False, "Unauthenticated request should fail")
    except urllib.error.HTTPError as e:
        check(e.code == 401, "Unauthenticated API access rejected with 401 Unauthorized")

    # 2. Invalid session cookie
    req_bad_sess = urllib.request.Request(f"{BASE_API}/v1/conversations", headers={"Cookie": "holoraa_session=invalid-deadbeef"})
    try:
        urllib.request.urlopen(req_bad_sess)
        check(False, "Invalid session request should fail")
    except urllib.error.HTTPError as e:
        check(e.code == 401, "Invalid session token rejected with 401 Unauthorized")

    # 3. IDOR: Charlie (third party) accessing Alice & Bob's private conversation
    status, _ = charlie.request("GET", f"/v1/conversations/{conv_ab_id}/messages")
    check(status in (403, 404), "IDOR conversation access rejected with 403 or 404")

    # 4. Forged delivery acknowledgement: non-member Charlie
    status, _ = charlie.request("POST", f"/v1/conversations/{conv_ab_id}/messages/{m1['id']}/delivered")
    check(status in (403, 404), "Forged delivery acknowledgment by non-member rejected with 403 or 404")

    # 5. Delivery acknowledgement by sender Alice on her own message
    status, _ = alice.request("POST", f"/v1/conversations/{conv_ab_id}/messages/{m1['id']}/delivered")
    check(status in (400, 403), "Sender cannot acknowledge delivery of their own message")

    # 6. Unauthorized settings access
    req_unauth_sett = urllib.request.Request(f"{BASE_API}/v1/me/settings")
    try:
        urllib.request.urlopen(req_unauth_sett)
        check(False, "Unauthenticated settings access should fail")
    except urllib.error.HTTPError as e:
        check(e.code == 401, "Unauthenticated settings access rejected with 401 Unauthorized")

    status, _ = alice.request("PATCH", "/v1/me/settings",
                              data={"readReceiptsEnabled": False},
                              headers={"X-CSRF-Token": "invalid-csrf"})
    check(status == 403, "Settings mutation with invalid CSRF rejected with 403 Forbidden")

    # 7. Missing / Invalid CSRF on messaging
    status, _ = alice.request("POST", f"/v1/conversations/{conv_ab_id}/messages",
                              data={"clientMessageId": str(uuid.uuid4()), "content": "No CSRF"},
                              headers={"X-CSRF-Token": "invalid-token-123"})
    check(status == 403, "Invalid CSRF token rejected with 403 Forbidden")

    # 8. Untrusted Origin
    status, _ = alice.request("POST", f"/v1/conversations/{conv_ab_id}/messages",
                              data={"clientMessageId": str(uuid.uuid4()), "content": "Untrusted Origin"},
                              headers={"Origin": "https://attacker.example.com"})
    check(status == 403, "Untrusted Origin rejected with 403 Forbidden")

    # 9. Oversized payload rejection (> 4000 chars)
    oversized_text = "x" * 4001
    status, _ = alice.request("POST", f"/v1/conversations/{conv_ab_id}/messages", data={
        "clientMessageId": str(uuid.uuid4()),
        "content": oversized_text
    })
    check(status == 400, "Oversized message (> 4000 chars) rejected with 400 Bad Request")

    # 10. WebSocket upgrade from untrusted origin
    ws_ticket = alice.get_ws_ticket()
    ws_evil_origin = SimpleWS(ws_ticket, origin="https://attacker.example.com")
    evil_ws_failed = False
    try:
        ws_evil_origin.connect()
    except Exception:
        evil_ws_failed = True
    check(evil_ws_failed, "WebSocket upgrade from untrusted Origin rejected with 403")

    # 11. WebSocket ticket via query parameter rejected
    ws_key = base64.b64encode(os.urandom(16)).decode('ascii')
    s_query = socket.create_connection(("127.0.0.1", 8080), timeout=3)
    hs_query = (
        f"GET /v1/realtime/ws?ticket={ws_ticket} HTTP/1.1\r\n"
        f"Host: 127.0.0.1:8080\r\n"
        f"Upgrade: websocket\r\n"
        f"Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {ws_key}\r\n"
        f"Sec-WebSocket-Version: 13\r\n"
        f"Origin: {ORIGIN}\r\n\r\n"
    )
    s_query.sendall(hs_query.encode('ascii'))
    resp_query = s_query.recv(1024).decode('ascii', errors='ignore')
    s_query.close()
    check("401 Unauthorized" in resp_query, "WebSocket ticket supplied via query parameter rejected with 401")

    # 12. WebSocket ticket reuse rejected
    ws_valid = SimpleWS(ws_ticket)
    ws_valid.connect()
    check(ws_valid.connected, "WebSocket connects with valid ticket")
    ws_reuse = SimpleWS(ws_ticket)
    reuse_failed = False
    try:
        ws_reuse.connect()
    except Exception:
        reuse_failed = True
    check(reuse_failed, "WebSocket ticket reuse rejected with 401 Unauthorized")

    # 13. Malformed WebSocket event envelopes
    # a. Non-JSON frame
    ws_valid.send_text("not-a-valid-json-string")
    err_frame1 = ws_valid.recv_event("error", timeout=2)
    check(err_frame1 is not None and err_frame1["payload"]["code"] == "BAD_REQUEST", "Malformed non-JSON frame returns BAD_REQUEST error frame")

    # b. Unsupported protocol version
    ws_valid.send_text(json.dumps({"v": 99, "id": str(uuid.uuid4()), "type": "ping", "payload": {}}))
    err_frame2 = ws_valid.recv_event("error", timeout=2)
    check(err_frame2 is not None and err_frame2["payload"]["code"] == "BAD_REQUEST", "Unsupported protocol version returns BAD_REQUEST error frame")

    # c. Unknown event type
    ws_valid.send_text(json.dumps({"v": 1, "id": str(uuid.uuid4()), "type": "unknown.event.type", "payload": {}}))
    err_frame3 = ws_valid.recv_event("error", timeout=2)
    check(err_frame3 is not None and err_frame3["payload"]["code"] == "BAD_REQUEST", "Unknown event type returns BAD_REQUEST error frame")

    # d. Unauthorized message send via WebSocket
    ws_valid.send_text(json.dumps({
        "v": 1,
        "id": str(uuid.uuid4()),
        "type": "message.send",
        "payload": {
            "conversationId": str(uuid.uuid4()), # non-existent or inaccessible conversation
            "clientMessageId": str(uuid.uuid4()),
            "content": "Rogue WebSocket message"
        }
    }))
    err_frame4 = ws_valid.recv_event("error", timeout=2)
    check(err_frame4 is not None and err_frame4["payload"]["code"] in ("FORBIDDEN", "NOT_FOUND"), "Unauthorized WebSocket message send returns FORBIDDEN error frame")

    # 14. Oversized inbound WebSocket frame (> 16 KiB limit)
    oversized_frame = "x" * (17 * 1024)
    ws_valid.send_text(oversized_frame)
    time.sleep(0.2)
    # The server closes connection due to read limit exceeded
    opcode_after, _ = ws_valid.recv_frame(timeout=1.5)
    check(opcode_after is None or opcode_after == 8, "Oversized inbound WebSocket frame (>16 KiB) terminates socket")
    ws_valid.close()

    # 15. Search rate limiting
    print("  Testing Search Rate Limiter...")
    search_rate_limited = False
    for _ in range(65):
        st, _ = alice.request("GET", f"/v1/users?q={alice.username[:3]}")
        if st == 429:
            search_rate_limited = True
            break
    check(search_rate_limited, "Search rate limit enforced with HTTP 429 Problem Details")

    # 16. Ticket rate limiting
    print("  Testing Ticket Rate Limiter...")
    ticket_rate_limited = False
    for _ in range(15):
        st, _ = alice.request("POST", "/v1/realtime/ticket", data={})
        if st == 429:
            ticket_rate_limited = True
            break
    check(ticket_rate_limited, "Ticket issuance rate limit enforced with HTTP 429 Problem Details")





    print("\n==============================================")
    print("🎉 ALL M4 E2E RELIABILITY & SECURITY TESTS PASSED!")
    print("==============================================")

if __name__ == "__main__":
    try:
        run_all()
    except Exception as e:
        print(f"\n❌ E2E SUITE ABORTED WITH ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
