"""Unit tests for the error hierarchy and transport error mapping (no network)."""

import pytest

from scrolller._errors import (
    AuthRequiredError,
    DownloadError,
    GraphQLError,
    InvalidTokenError,
    NetworkError,
    NotFoundError,
    ProxyError,
    RateLimitedError,
    ScrolllerError,
)
from scrolller._transport import _interpret_response, _raise_for_graphql_errors
from scrolller._types import ErrorKind


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
