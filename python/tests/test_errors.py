"""Unit tests for the error hierarchy, transport error mapping and payload building (no network)."""

import json

import pytest

from scrolller._errors import (
    AuthRequiredError,
    DownloadError,
    GraphQLError,
    InvalidCredentialsError,
    InvalidTokenError,
    NetworkError,
    NotFoundError,
    ProxyError,
    RateLimitedError,
    ScrolllerAuthRequiredError,
    ScrolllerError,
)
from scrolller._transport import (
    _build_client,
    _build_payload,
    _interpret_response,
    _raise_for_graphql_errors,
)
from scrolller._types import ErrorKind, ProxyConfig


class _FakeResponse:
    """Minimal stand-in for httpx.Response (only what _interpret_response uses)."""

    def __init__(self, status_code, body=None):
        self.status_code = status_code
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("no body")
        return self._body


CASES = [
    (AuthRequiredError, ErrorKind.AUTH_REQUIRED),
    (InvalidCredentialsError, ErrorKind.INVALID_CREDENTIALS),
    (InvalidTokenError, ErrorKind.INVALID_TOKEN),
    (GraphQLError, ErrorKind.GRAPHQL_ERROR),
    (RateLimitedError, ErrorKind.RATE_LIMITED),
    (NetworkError, ErrorKind.NETWORK_ERROR),
    (ProxyError, ErrorKind.PROXY_ERROR),
    (NotFoundError, ErrorKind.NOT_FOUND),
    (DownloadError, ErrorKind.DOWNLOAD_ERROR),
]


@pytest.mark.parametrize("cls,kind", CASES, ids=[cls.__name__ for cls, _ in CASES])
def test_error_kinds(cls, kind):
    err = cls("boom")
    assert isinstance(err, ScrolllerError)
    assert err.kind == kind
    assert str(err) == "boom"
    assert err.http_status is None
    assert err.details == {}


def test_graphql_error_carries_errors_and_status():
    errors = [{"message": "bad", "extensions": {"code": "BAD_USER_INPUT"}}]
    err = GraphQLError("msg", errors=errors, http_status=400)
    assert err.errors == errors
    assert err.http_status == 400
    assert err.kind == ErrorKind.GRAPHQL_ERROR


def test_invalid_token_is_graphql_error_with_own_kind():
    err = InvalidTokenError("expired", errors=[{"message": "x"}], http_status=200)
    assert isinstance(err, GraphQLError)
    assert err.kind == ErrorKind.INVALID_TOKEN
    assert err.errors == [{"message": "x"}]


def test_scrolller_auth_required_alias():
    assert ScrolllerAuthRequiredError is AuthRequiredError


def test_explicit_kind_overrides_default():
    err = NetworkError("weird", kind=ErrorKind.PROXY_ERROR)
    assert err.kind == ErrorKind.PROXY_ERROR


# ------------------------------------------------- transport error mapping


def test_rate_limited_on_429():
    with pytest.raises(RateLimitedError) as excinfo:
        _interpret_response(_FakeResponse(429))
    assert excinfo.value.http_status == 429


def test_not_found_on_404():
    with pytest.raises(NotFoundError) as excinfo:
        _interpret_response(_FakeResponse(404))
    assert excinfo.value.http_status == 404


def test_http_error_with_graphql_errors_preserved():
    body = {"errors": [{"message": "nope", "extensions": {"code": "BAD_USER_INPUT"}}]}
    with pytest.raises(GraphQLError) as excinfo:
        _interpret_response(_FakeResponse(400, body))
    assert excinfo.value.errors == body["errors"]
    assert excinfo.value.http_status == 400


def test_http_error_without_graphql_body():
    with pytest.raises(GraphQLError) as excinfo:
        _interpret_response(_FakeResponse(403))
    assert excinfo.value.http_status == 403


def test_graphql_errors_on_200_unauthenticated():
    body = {"errors": [{"message": "denied", "extensions": {"code": "UNAUTHENTICATED"}}]}
    with pytest.raises(InvalidTokenError):
        _interpret_response(_FakeResponse(200, body))


def test_graphql_errors_on_200_generic_code():
    body = {"errors": [{"message": "bad input", "extensions": {"code": "BAD_USER_INPUT"}}]}
    with pytest.raises(GraphQLError) as excinfo:
        _interpret_response(_FakeResponse(200, body))
    assert excinfo.value.errors == body["errors"]


def test_invalid_json_is_network_error():
    with pytest.raises(NetworkError):
        _interpret_response(_FakeResponse(200))


def test_non_object_body_is_network_error():
    with pytest.raises(NetworkError):
        _interpret_response(_FakeResponse(200, [1, 2]))


def test_success_returns_data():
    assert _interpret_response(_FakeResponse(200, {"data": {"ok": True}})) == {"ok": True}


def test_forbidden_code_maps_to_invalid_token():
    errors = [{"message": "forbidden", "extensions": {"code": "FORBIDDEN"}}]
    with pytest.raises(InvalidTokenError):
        _raise_for_graphql_errors(errors, http_status=200)


def test_wrong_credentials_message_maps_to_invalid_credentials():
    # Server sends generic INTERNAL_SERVER_ERROR code — mapping is by message
    # (CONTRACT.md §5.1, RESEARCH.md §3a).
    errors = [
        {
            "message": "Username or password is incorrect",
            "extensions": {"code": "INTERNAL_SERVER_ERROR"},
        }
    ]
    with pytest.raises(InvalidCredentialsError) as excinfo:
        _raise_for_graphql_errors(errors, http_status=200)
    assert excinfo.value.kind == ErrorKind.INVALID_CREDENTIALS
    assert excinfo.value.errors == errors


def test_other_internal_server_error_stays_graphql_error():
    errors = [{"message": "something else broke", "extensions": {"code": "INTERNAL_SERVER_ERROR"}}]
    with pytest.raises(GraphQLError):
        _raise_for_graphql_errors(errors, http_status=200)


# ------------------------------------------------ F2: null variables omitted


def test_payload_omits_null_variables():
    payload = json.loads(
        _build_payload(
            "query DiscoverFilteredSubredditsQuery { x }",
            {
                "filter": None,
                "iterator": None,
                "excludeFilters": None,
                "limit": 2,
                "nsfw": "SFW",
                "includeFilters": [],
            },
            None,
        )
    )
    assert payload["variables"] == {"limit": 2, "nsfw": "SFW", "includeFilters": []}
    assert payload["authorization"] is None


def test_payload_keeps_non_null_values_and_token():
    payload = json.loads(_build_payload("q", {"iterator": "7", "limit": 1}, "tok"))
    assert payload["variables"] == {"iterator": "7", "limit": 1}
    assert payload["authorization"] == "tok"


def test_payload_none_variables_become_empty_object():
    payload = json.loads(_build_payload("q", None, None))
    assert payload["variables"] == {}
    assert payload["query"] == "q"


# --------------------------------- F3: unsupported proxy scheme, no cred leak


def test_socks4_proxy_raises_proxy_error_without_credentials():
    config = ProxyConfig(
        type="socks4", host="127.0.0.1", port=1080, username="alice", password="hunter2"
    )
    with pytest.raises(ProxyError) as excinfo:
        _build_client(proxy=config, timeout_ms=30000)
    message = str(excinfo.value)
    assert "hunter2" not in message  # the password must never appear
    assert "socks4" in message
    assert excinfo.value.kind == ErrorKind.PROXY_ERROR
