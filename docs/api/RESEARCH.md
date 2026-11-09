# Scrolller API — VERIFIED RESEARCH (live probes + bundle analysis)

Status: endpoint **verified live** (HTTP 200, real data). This file is the ground truth for `CONTRACT.md`.
Values marked `[verified]` were confirmed by real requests on 2026-11-10; other details come from JS bundle analysis (see §Sources).

## 1. Endpoint & request format [verified]

```
POST https://api.scrolller.com/admin
Content-Type: application/json
Accept: */*
Origin: https://scrolller.com        (not strictly required — worked without, but keep for parity)
User-Agent: any (worked with curl default and Chrome UA)
```

Body (single JSON object):

```json
{
  "query": "<GraphQL document>",
  "variables": { ... },
  "authorization": "<token string> | null"
}
```

- **Auth is a top-level body field** `authorization` (NOT an HTTP header). Anonymous → `null`.
- Introspection (`__schema`/`__type`) is **disabled** (Apollo Server). Enums must be taken from bundle analysis or value probes.
- Errors: standard GraphQL `errors[]` with `extensions.code` (`BAD_USER_INPUT`, `GRAPHQL_VALIDATION_FAILED`).

## 2. Discovered enums [verified]

| Enum | Values confirmed |
| --- | --- |
| `NsfwFilter` | `SFW`, `NSFW`, `ALL` |
| `GallerySortBy` | `HOT` (others TBD from bundles: expected TRENDING/POPULAR/NEW) |
| `GalleryFilter` | TBD from bundles (expected image/animated/gallery tiers) |

## 3. Home/discover feed [verified]

Operation (verbatim from live page traffic):

```graphql
query DiscoverFilteredSubredditsQuery(
  $filter: GalleryFilter
  $sortBy: GallerySortBy
  $limit: Int!
  $childLimit: Int!
  $iterator: String
  $includeFilters: [Int!]
  $excludeFilters: [Int!]
  $nsfw: NsfwFilter
) {
  discoverFilteredSubreddits(data: {
    nsfw: $nsfw
    filter: $filter
    limit: $limit
    childLimit: $childLimit
    iterator: $iterator
    includeFilters: $includeFilters
    excludeFilters: $excludeFilters
    sortBy: $sortBy
  }) {
    iterator
    recommendationType
    hasV1Recommendations
    hasV2Recommendations
    items {            # subreddit cards
      __typename id url title secondaryTitle description createdAt isNsfw
      subscribers isComplete itemCount videoCount pictureCount albumCount
      isPaid username tags
      banner { url width height isOptimized }
      isFollowing
      moreSubreddits { id url title isPaid isNsfw previewUrl }
      children {       # posts inside the subreddit card
        iterator
        items {        # post/media objects
          __typename id url reddit_posted_by subredditId subredditTitle
          subredditUrl subredditIsFollowing redditPath isNsfw hasAudio
          fullLengthSource gfycatSource redgifsSource ownerAvatar username
          displayName userType favoriteCount repostCount isPaid tags
          commentsCount commentsRepliesCount duration createdAt
          albumContent { mediaSources { url width height isOptimized type } }
          isFavorite isReposted
          mediaSources { url width height isOptimized type }
          blurredMediaSources { url width height isOptimized type }
        }
      }
    }
  }
}
```

Site default variables (as captured): `{"limit":20,"iterator":"<cursor>","nsfw":"SFW","includeFilters":[],"sortBy":"HOT","childLimit":2}`.

- `iterator` is an opaque string cursor; pass back `iterator` from the previous response for the next page. First page → `null`/omitted.
- `childLimit` = number of posts embedded per subreddit card.

## 4. Media URLs [verified sample]

- Image host: `https://images.scrolller.com/zepto/...-WxH.webp` (optimized variants) and original `.jpg`/`.png`.
- Video host: `https://zepto.scrolller.com/<post-slug>.mp4` / `.webm` — **videos come directly in `mediaSources[]`** with `type: "MP4" | "WEBM"` and width/height.
- `mediaSources[]` types observed [verified]: `WEBP`, `JPEG`, `PNG`, `GIF`, `MP4`, `WEBM`. List sorted small→large; pick last (or best per type) for download.
- Video URL probes [verified]: `HTTP 200`, `Content-Type: video/mp4`, `Accept-Ranges: bytes`, `Range: bytes=0-1023` → `206` (resumable + progress supported). No auth, no special headers.
- ⚠️ `gfycatSource` / `redgifsSource` / `fullLengthSource` can be the literal string `"undefined"` (backend artifact) — clients MUST normalize to `null`.
- `hasAudio`, `duration` (seconds, null for images) on posts; audio sidecar TBD from T1.

## 3a. Login [verified]

Captured live from the login form (POST `https://api.scrolller.com/admin`, same body format):

```graphql
query LoginQuery($username: String!, $password: String!) {
  login(username: $username, password: $password) {
    username
    token
    expiresAt
    isAdmin
    deleted_at
    isPremium
  }
}
```

- `username` accepts username **or email**; password sent as plaintext over HTTPS (no client-side hashing).
- Success → `token` + `expiresAt` (token expiry — persist both; clients can warn/re-auth on expiry).
- Wrong credentials → HTTP 200 with `errors[0].message = "Username or password is incorrect"`, `extensions.code: "INTERNAL_SERVER_ERROR"` (no dedicated error code!). Clients must map by message.
- Anonymous requests carry `authorization: null`; authenticated requests pass the token in the same top-level body field.

## 5. Misc endpoints

- `https://api.scrolller.com/admin` — **the real GraphQL endpoint** (despite `NEXT_PUBLIC_HTTP_API=https://api.scrolller.com/api/v2/graphql` printed in a debug console.log — that path 404s [verified]).
- `https://host4.scrolller.com/upload`, `https://host8.scrolller.com/upload` — upload links (from bundles; TBD).
- `https://trk.scrolller.com` — tracking.
- GraphQL on main domain `/graphql` = subreddit route, NOT the API [verified 308→/r/graphql].

## 6. Operation inventory (from bundles — details in report of T1)

Queries: Account, DiscoverFilteredSubredditsQuery, GetAllFollowingContent, GetAllRecommendationsContent, GetCollectionById, GetConversations, GetFollowingCollections, GetFollowingSubreddits, GetIsFollowingSubreddit, GetIsFollowingUser, GetIsFollowingUserCollection, GetLoggedInUserQuery, GetMessages, GetPostIsFavorite, GetPostsByCreators, GetTotalUnreadCount, GetUserCollectionQuery, GetUserCollectionsQuery, GetUserHideContentRules, GetUserHideContentRulesWithUrl, NotificationsQuery, PaidCollections, PlanQuery, PostHiddenTags, PostsByTag, RedditUserPostsQuery, ResolveScrolllerLinks, SearchCollectionsQuery, SearchSubredditWithPreview, SearchSubredditsQuery, SearchUsersQuery, SubredditChildrenQuery, SubredditPostQuery, SubredditQuery, Subscription, UserPostsQuery, getCollectionSetup, getCreatorReport, getRevShare, getUserCollectionContentQuery, getUserRecommendationsAvailability, getUserSubredditsQuery.

Mutations: AddFavorite, Follow, HideContent, MarkMessagesAsRead, MarkPostWithSound, RegisterQuery, RemoveFavorite, RemoveRepost, RenewLoginToken, RepostPost, SendMessage, UnhideContent, UpdateUser, markAllNotificationsAsRead, markNotificationAsArchived, markNotificationAsUnarchived, sendContentMetrics, setUserCTALastClosed, setUserLeaderBoardLastClosed, updateInfo, updateUserLastActive.

→ Full SDL text for each operation: filled from T1 report into `CONTRACT.md`.

## 7. Sources

- 37 minified Next.js chunks: `tmp/scrolller-js/bundles/` (not committed; analyzed read-only).
- Live traffic capture via in-app browser (fetch/XHR hook) on scrolller.com home feed.
- Live curl probes against the endpoint (discover feed, enum validation, introspection attempt).
