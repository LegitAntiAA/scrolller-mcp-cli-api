"""Account/profile/billing/creator operations (CONTRACT.md §6 rows 15, 16a–c
+ T1 §2, §3d, §3k, §3l).

Login is public (CONTRACT.md row 16a is 🔓) and persists ``token`` +
``expires_at`` to the config file on success. ``get_plans`` is public too
(T1 §2: PlanQuery verified working with ``authorization: null``). Everything
else in this module fails fast AUTH_REQUIRED without a token.

Payment mutations (sticky.io/bitcoin) are deliberately NOT implemented:
they require invisible reCAPTCHA v2 server-side (CONTRACT.md row 26) and the
surface is read-only here.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Union

from scrolller._graphql import (
    Q_ACCOUNT,
    Q_ADD_CREATOR_POST,
    Q_GET_CREATOR_REPORT,
    Q_GET_LOGGED_IN_USER,
    Q_GET_REV_SHARE,
    Q_LOGIN,
    Q_PLAN,
    Q_SUBSCRIPTION,
    Q_UPDATE_INFO,
    Q_UPDATE_USER,
)
from scrolller._models import (
    AccountCard,
    CreatorReport,
    LoginResult,
    Plan,
    SubscriptionInfo,
    UploadResult,
    account_from_raw,
    creator_report_from_raw,
    login_result_from_raw,
    plan_from_raw,
    subscription_from_raw,
)
from scrolller._types import UPLOAD_URL

__all__ = ["AccountOps", "AsyncAccountOps"]


class AccountOps:
    """Sync mixin: auth, profile, read-only billing/creator, upload."""

    def login(self, username: str, password: str) -> LoginResult:
        """Login with credentials (LoginQuery — needs no captcha, T1 §2).

        On success the token + ``expires_at`` are persisted to the config
        file (CONTRACT.md row 16a) and the client token is replaced.
        """
        data = self._request(Q_LOGIN, {"username": username, "password": password})
        result = login_result_from_raw((data or {}).get("login") or {})
        if result.token:
            self._options.token = result.token
            self._persist_config_values(
                self._options, {"token": result.token, "expires_at": result.expires_at}
            )
        return result

    def logout(self) -> None:
        """Clear the stored token from the client and the config file (row 16c)."""
        self._options.token = None
        self._persist_config_values(self._options, {"token": None, "expires_at": None})

    def me(self) -> Any:
        """Signed-in user profile (GetLoggedInUserQuery) → :class:`LoggedInUser`."""
        self._require_token()
        data = self._request(Q_GET_LOGGED_IN_USER)
        from scrolller._models import user_from_raw  # local import keeps module graph flat

        return user_from_raw((data or {}).get("getLoggedInUser") or {})

    def update_user(
        self,
        *,
        email: Optional[str] = None,
        username: Optional[str] = None,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        display_name: Optional[str] = None,
        location: Optional[str] = None,
        birthday: Optional[str] = None,
        bio: Optional[str] = None,
    ) -> Any:
        """Patch profile fields (UpdateUser). ``None`` fields are omitted (kept)."""
        self._require_token()
        variables = {
            "email": email,
            "username": username,
            "first_name": first_name,
            "last_name": last_name,
            "display_name": display_name,
            "location": location,
            "birthday": birthday,
            "bio": bio,
        }
        return self._request(Q_UPDATE_USER, variables, is_mutation=True)

    def update_info(self) -> Any:
        """Trigger the site's updateInfo mutation (verbatim, no arguments)."""
        self._require_token()
        return self._request(Q_UPDATE_INFO, is_mutation=True)

    # -- read-only billing (payments are captcha-gated: NOT implemented) ------

    def get_plans(self) -> List[Plan]:
        """Premium plans (PlanQuery — public per T1 §2 live verification)."""
        data = self._request(Q_PLAN)
        return [
            plan_from_raw(item)
            for item in ((data or {}).get("subscription_plans") or [])
            if isinstance(item, dict)
        ]

    def get_account(self) -> AccountCard:
        """Saved card details of the signed-in user (Account → myAccount)."""
        self._require_token()
        data = self._request(Q_ACCOUNT)
        return account_from_raw((data or {}).get("myAccount") or {})

    def get_subscription(self) -> SubscriptionInfo:
        """Current subscription incl. per-collection ones (Subscription)."""
        self._require_token()
        data = self._request(Q_SUBSCRIPTION)
        return subscription_from_raw((data or {}).get("mySubscription") or {})

    # -- read-only creator surface ---------------------------------------------

    def get_creator_report(self) -> CreatorReport:
        self._require_token()
        data = self._request(Q_GET_CREATOR_REPORT)
        return creator_report_from_raw((data or {}).get("getCreatorReport") or {})

    def get_rev_share(self) -> Any:
        self._require_token()
        return self._request(Q_GET_REV_SHARE)

    # -- upload (creator) --------------------------------------------------------

    def upload_media(
        self,
        file: Union[str, Path, bytes],
        *,
        blur: Optional[bool] = None,
        filename: Optional[str] = None,
    ) -> UploadResult:
        """Upload media to ``https://host8.scrolller.com/upload`` (multipart).

        Multipart fields follow the site helper (T1 §9, file
        04dk90lrwy2lz.js): ``content`` (the file), ``file_key``, optional
        ``blur`` (sent as ``"true"``/``"false"``; omitted when ``None``),
        ``Authorization`` (the token). Response shape:
        ``{url, sourceSetId}``. Feed ``url``/``sourceSetId`` into
        :meth:`add_creator_post`.
        """
        token = self._require_token()
        if isinstance(file, bytes):
            data = file
            name = filename or "upload"
        else:
            path = Path(file)
            data = path.read_bytes()
            name = filename or path.name
        fields: Dict[str, Any] = {"file_key": name, "Authorization": token}
        if blur is not None:
            fields["blur"] = "true" if blur else "false"
        result = self._upload_put(
            UPLOAD_URL, data=fields, files={"content": (name, data)}
        )
        result = result if isinstance(result, dict) else {}
        return UploadResult(
            url=result.get("url"),
            source_set_id=result.get("sourceSetId"),
            raw=result,
        )

    def add_creator_post(
        self,
        *,
        title: str,
        keywords: str,
        media_url: str,
        subreddit_url: str,
        source_set_id: int,
        media_type: str,
        is_nsfw: bool = False,
        set_header: bool = False,
    ) -> Dict[str, Any]:
        """Publish an uploaded media as a creator post (uploadPostToSubreddit).

        ``media_url``/``source_set_id`` come from :meth:`upload_media`.
        ``media_type`` is the site's string (e.g. ``"PICTURE"``/``"VIDEO"``).
        Returns the raw ``{title, url}`` dict.
        """
        self._require_token()
        variables = {
            "title": title,
            "keywords": keywords,
            "isNsfw": bool(is_nsfw),
            "mediaUrl": media_url,
            "subredditUrl": subreddit_url,
            "sourceSetId": int(source_set_id),
            "setHeader": bool(set_header),
            "mediaType": media_type,
        }
        return self._request(Q_ADD_CREATOR_POST, variables, is_mutation=True) or {}


class AsyncAccountOps:
    """Async mirror of :class:`AccountOps`."""

    async def login(self, username: str, password: str) -> LoginResult:
        data = await self._request(Q_LOGIN, {"username": username, "password": password})
        result = login_result_from_raw((data or {}).get("login") or {})
        if result.token:
            self._options.token = result.token
            self._persist_config_values(
                self._options, {"token": result.token, "expires_at": result.expires_at}
            )
        return result

    async def logout(self) -> None:
        self._options.token = None
        self._persist_config_values(self._options, {"token": None, "expires_at": None})

    async def me(self) -> Any:
        self._require_token()
        data = await self._request(Q_GET_LOGGED_IN_USER)
        from scrolller._models import user_from_raw

        return user_from_raw((data or {}).get("getLoggedInUser") or {})

    async def update_user(
        self,
        *,
        email: Optional[str] = None,
        username: Optional[str] = None,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        display_name: Optional[str] = None,
        location: Optional[str] = None,
        birthday: Optional[str] = None,
        bio: Optional[str] = None,
    ) -> Any:
        self._require_token()
        variables = {
            "email": email,
            "username": username,
            "first_name": first_name,
            "last_name": last_name,
            "display_name": display_name,
            "location": location,
            "birthday": birthday,
            "bio": bio,
        }
        return await self._request(Q_UPDATE_USER, variables, is_mutation=True)

    async def update_info(self) -> Any:
        self._require_token()
        return await self._request(Q_UPDATE_INFO, is_mutation=True)

    async def get_plans(self) -> List[Plan]:
        data = await self._request(Q_PLAN)
        return [
            plan_from_raw(item)
            for item in ((data or {}).get("subscription_plans") or [])
            if isinstance(item, dict)
        ]

    async def get_account(self) -> AccountCard:
        self._require_token()
        data = await self._request(Q_ACCOUNT)
        return account_from_raw((data or {}).get("myAccount") or {})

    async def get_subscription(self) -> SubscriptionInfo:
        self._require_token()
        data = await self._request(Q_SUBSCRIPTION)
        return subscription_from_raw((data or {}).get("mySubscription") or {})

    async def get_creator_report(self) -> CreatorReport:
        self._require_token()
        data = await self._request(Q_GET_CREATOR_REPORT)
        return creator_report_from_raw((data or {}).get("getCreatorReport") or {})

    async def get_rev_share(self) -> Any:
        self._require_token()
        return await self._request(Q_GET_REV_SHARE)

    async def upload_media(
        self,
        file: Union[str, Path, bytes],
        *,
        blur: Optional[bool] = None,
        filename: Optional[str] = None,
    ) -> UploadResult:
        token = self._require_token()
        if isinstance(file, bytes):
            data = file
            name = filename or "upload"
        else:
            path = Path(file)
            data = path.read_bytes()
            name = filename or path.name
        fields: Dict[str, Any] = {"file_key": name, "Authorization": token}
        if blur is not None:
            fields["blur"] = "true" if blur else "false"
        result = await self._upload_put(
            UPLOAD_URL, data=fields, files={"content": (name, data)}
        )
        result = result if isinstance(result, dict) else {}
        return UploadResult(
            url=result.get("url"),
            source_set_id=result.get("sourceSetId"),
            raw=result,
        )

    async def add_creator_post(
        self,
        *,
        title: str,
        keywords: str,
        media_url: str,
        subreddit_url: str,
        source_set_id: int,
        media_type: str,
        is_nsfw: bool = False,
        set_header: bool = False,
    ) -> Dict[str, Any]:
        self._require_token()
        variables = {
            "title": title,
            "keywords": keywords,
            "isNsfw": bool(is_nsfw),
            "mediaUrl": media_url,
            "subredditUrl": subreddit_url,
            "sourceSetId": int(source_set_id),
            "setHeader": bool(set_header),
            "mediaType": media_type,
        }
        return await self._request(Q_ADD_CREATOR_POST, variables, is_mutation=True) or {}
