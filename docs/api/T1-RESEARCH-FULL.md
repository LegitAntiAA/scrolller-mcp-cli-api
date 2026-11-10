# Scrolller.com Web API — Reconstruction Report

All GraphQL text below is **verbatim from the bundles** (the `\n` escapes in the JS string literals are rendered as line breaks; the client collapses whitespace with `query.replace(/\s+/g," ")` before sending, so formatting is irrelevant to the server). Nothing is invented; where a document was built by JS string concatenation the substituted fragment is shown inline in braces `{...}` and the exact fragment source is given in section 4. Operations I could not find in any bundle are explicitly flagged.

---

## 1. ENDPOINTS

### GraphQL (single endpoint, POST only)
- **`POST https://api.scrolller.com/admin`** — this is THE GraphQL endpoint of the current web build.
  - Verified live during this analysis: posting a read-only query to it returns `{"data":{...}}`; `POST /api/v2/graphql` now returns the Next.js HTML fallback (dead route).
  - Bundled evidence: the only `fetch` wrapper (turbopack module 490665, file `1nh9bs67l4tet.js`) does `fetch(o.c, ...)` where `o.c` is module 58785's export `c` = `"https://api.scrolller.com/admin"` (fallback constant; `SERVER_ADMIN_API` env is only read when flag `447800.l` is true, and that flag is hard-coded `false`).
  - The strings `"https://api.scrolller.com/api/v2/graphql"` (labelled `NEXT_PUBLIC_HTTP_API`) and `"https://api.scrolller.com/admin"` (labelled `NEXT_PUBLIC_ADMIN_API`) appear only in a debug `console.log` in `1x889n0qsee9p.js` — the log is stale; the actual client posts to `/admin`.

**Exact request shape (module 490665):**
```js
fetch("https://api.scrolller.com/admin", {
  method: "POST",
  cache: "default",                       // "no-store" only in E2E build flag
  body: JSON.stringify({
    query: <query string, whitespace-collapsed>,
    variables: {...},
    authorization: <token string or null>  // AUTH IS A TOP-LEVEL BODY FIELD
  }),
  headers: {
    "accept": "*/*",
    "content-type": "application/json",
    // optionally: "x-anonymous-user-id": "anon_<uuid>"  (only when caller passes includeAnonymousUserId:true — only sendContentMetrics does)
  },
  // sendContentMetrics additionally passes fetch keepalive: true
})
```
- **No `Authorization` HTTP header.** No cookies are read or set by the client. No CSRF token.
- Response parsed as `{data, errors}`; on non-empty `errors` the client throws `Error(JSON.stringify({...errors[0], name:"API_ERROR"}))`; error text is later recovered via `JSON.parse(err.message).message`. An `extensions.relatedField` is inspected on register-username errors.
- Anonymous requests send `"authorization": null` in the body.

### Other endpoints found
| URL | Method | Purpose |
|---|---|---|
| `https://api.scrolller.com/admin` | POST | GraphQL (all operations incl. billing) |
| `https://host8.scrolller.com/upload` | PUT | File upload (multipart; config module 58785 export `l`) |
| `https://host4.scrolller.com/upload` | (debug log only) | Upload link printed as `NEXT_PUBLIC_UPLOAD_LINK`; actual code uses host8 |
| `https://trk.scrolller.com` (+ GUID paths e.g. `/0c5de291-7864-46bb-b943-46afc076b5a8`, `/cea62c5f-5b66-47f9-a2fb-7f90357a92ec`, `/e6404d3b-179d-48e2-bb4f-a1a6e1e55a84`) | GET | affiliate/premium-CTA click tracking (`PROD_TRACKING_DOMAIN_URL`); also used as ad `adUrl` click redirect in the native-ad payload |
| `https://www.reddit.com/r/<sub>/about.json` | GET | client-side fallback fetch of subreddit info from Reddit (`"t5"` kind check) |
| `/api/agent-feedback`, `/api/geolocation` | — | Next.js internal routes (route enum module 881193) |
| `https://www.google.com/recaptcha/api.js?onload=...&render=explicit` | script | invisible reCAPTCHA v2 (prod sitekey `6LeJvwAiAAAAAKsG0MNtphyMm1sDjC0CcGopiowd`, from config export `R`) |
| Google Analytics 4 `G-D4WGVPSK8D` (prod) / `G-YKV7EWM1XX` (dev), Google Optimize `OPT-WFKF7TH`, Meta Pixel `1006683118745568` | script | analytics; GA4 `client_id`/`session_id` are linked into "watch sessions" (module 743091) |
| `https://www.googletagmanager.com/gtag/js`, `gtm.js` | script | GA/GTM loaders |

Media hosts are in section 5.

---

## 2. AUTH

**Mechanism: email/username + password via GraphQL; token returned in the response; reCAPTCHA v2 (invisible) on register / password-reset / card / phone ops. No OAuth, no Firebase.**

### Login
`query LoginQuery` (file `2tu3a32gpwctq.js`):
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
- Login itself needs **no captcha**. On success the client calls `setLoginDetails(login)` then reloads the user (`GetLoggedInUserQuery`) and tracks `user-login-success`.

### Registration
`mutation RegisterQuery` (file `112o4dm7xrxnr.js`) — **it really is user registration**, not a persisted-query registry:
```graphql
mutation RegisterQuery($data: RegisterUserInput!) {
  registerUser(data: $data) {
    username
    token
    expiresAt
    isAdmin
  }
}
```
Caller (module 267575) builds `$data` as:
`{username, password, email, enableEmailRecommendations, enableNsfwEmailRecommendations, captchaToken, ref?}` plus the UTM attribution object (see below). `captchaToken` is mandatory — the register form executes invisible reCAPTCHA v2 (`executeAsync()`); a captcha error is thrown if missing. `ref` = affiliate `source` value read from localStorage. Minimum password length constant `j.a` (module 447800 export `a` = 8).

### Token storage & format
- Stored in `localStorage` under key **`SCROLLLER_BETA_1:SCROLLLER_LOGIN_DEV`** (store helper uppercases the `"SCROLLLER_BETA_1:"+name` prefix). JSON object: `{username?, token, expiresAt, isAdmin?, deleted_at?, isPremium?, ...}`.
- `expiresAt` is **epoch seconds**; `isLoginTokenExpired(details)` returns true when `expiresAt - Date.now()/1000 - 3600 <= 0` (expiry margin 3600 s).
- Dev-only alt key `SCROLLLER_LOGIN_DEV` is also checked at store init.
- Token is attached **only** as the top-level `authorization` body field (section 1). Each request reads it fresh from localStorage.
- `RenewLoginToken` is called lazily: `N(details)` renews only if the token is inside the expiry margin (`g.j - (expiresAt - now/1000) < g.s`); on app start `B()` restores the session (GetLoggedInUserQuery → RenewLoginToken if due → merge into store). `updateUserLastActive` fires when `last_active_at` is older than 30 min (`18e6` ms).

### Password / account lifecycle
- `ForgetPasswordQuery($identifier: String!, $captchaToken: String!)` — captcha required. Route `/reset-password`.
- `ChangePasswordQuery($oldPassword: String!, $newPassword: String!)`.
- `DeleteQuery` → `deleteAccount`; plus `startRemoveMutation` (GDPR-style deletion start), `twilioVerify($code: String!)` → `twilioVerifyCheck`, `twilioVerifyGetNewCode($captchaToken: String!)`, `updateUserPhoneNumber($phoneNumber: String!, $captchaToken: String!)`, `sendVerifyEmail($captchaToken: String!)` (a **query** despite the name).

### Anonymous vs authenticated
- Anonymous clients can browse/discover/search/get posts/comments read (verified live: `getSubreddit`, `getPost`, `discoverFilteredSubreddits`, `PlanQuery` all work with `"authorization": null`).
- Favorites/reposts/follow/hide rules/collections/messages/notifications/comments-write/settings/subscription endpoints require the token (client code gates them behind `useLoginStore` state; the mutations themselves have no visible client-side auth flag).
- An anonymous id `anon_<crypto.randomUUID()>` is generated and stored under `SCROLLLER_BETA_1:ANONYMOUS_USER_ID` and sent **only** with `sendContentMetrics` as header `x-anonymous-user-id`.

---

## 3. GRAPHQL OPERATIONS

### Shared fragments (turbopack module 82742, file `33ful7xcc-m8h.js`) — expanded inline below as `{...}` where operations concatenate them

```graphql
# t(withBlurred) — media source selection
mediaSources {
  url
  width
  height
  isOptimized
  type
}
# plus, when withBlurred=true:
blurredMediaSources {
  url
  width
  height
  isOptimized
  type
}
```

```graphql
# Z = post fields, n()  (withUserData defaults true)
__typename
id
url
title
reddit_posted_by
subredditId
subredditTitle
subredditUrl
subredditIsFollowing
redditPath
isNsfw
hasAudio
fullLengthSource
gfycatSource
redgifsSource
ownerAvatar
username
displayName
userType
favoriteCount
repostCount
isPaid
tags
commentsCount
commentsRepliesCount
duration
createdAt
albumContent {
  mediaSources { url width height isOptimized type }
}
isFavorite        # only when withUserData
isReposted        # only when withUserData
mediaSources { url width height isOptimized type }   # POST-LEVEL sources (t(!0)) — this is where video sources come from
blurredMediaSources { url width height isOptimized type }
```
(Verified live: post-level `mediaSources` is required for video posts; `albumContent` is `null` for them.)

```graphql
# children fragment r()
children {
  iterator
  items {
    {Z post fields}
  }
}
```
Note: `children` carries **no arguments**; the callers pass `iterator/filter/limit/sortBy` into the builder but the builder ignores them (verified byte-exact).

```graphql
# J = subreddit/collection "own object" fields (withChildren opt)
__typename
id
url
title
description
is_private
is_nsfw
is_following
{children {...}}     # optional
```

```graphql
# d = "parent" subreddit fields (opts: withParent, withChildren, withDisplayMedia, withUserData, isSubreddit)
__typename
id
url
title
secondaryTitle
description
createdAt
isNsfw
subscribers
isComplete
itemCount
videoCount
pictureCount
albumCount
# when isSubreddit:
isPaid
username
tags
banner {
  url
  width
  height
  isOptimized
}
# when withDisplayMedia:
displayMedia {
  isNsfw
  mediaSources { url width height isOptimized type }
}
# when withUserData:
isFollowing
moreSubreddits {
  id
  url
  title
  isPaid
  isNsfw
  previewUrl
}
{children {...}}    # optional
```

```graphql
# _ = subscription fields
id
status
planName
interval
next_recurring
ends_at
product_id
payment_method
price
canManageSubscription
```

```graphql
# payment var/arg/response fragments
# N: variable decls      $action: String!, $captchaToken: String!, $offers: [Offer!]!, $tags: TagsInput
# D: arg fields          action: $action, captchaToken: $captchaToken, offers: $offers, tags: $tags,
# s: more var decls      $donationTo: String, $collectionTitle: String,
# F: more arg fields     donationTo: $donationTo, collectionTitle: $collectionTitle,
# g: response fields     response_code order_id error_message
```

---

### 3a. Media / feed (home = discover feed)

**`DiscoverFilteredSubredditsQuery`** (file `2v17z4u014h5e.js`) — **this is the home/discover feed** (the caller in `0_guih9kp32en.js` tracks `home_feed_view_<sort>`). There is **no** `getMedia`/`Itier`/`Atier`/`Gtier`/`pageLength` anywhere in the 118 chunks (checked case-insensitively); the old API names are gone.
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
  discoverFilteredSubreddits(
    data: {
      nsfw: $nsfw
      filter: $filter
      limit: $limit
      childLimit: $childLimit
      iterator: $iterator
      includeFilters: $includeFilters
      excludeFilters: $excludeFilters
      sortBy: $sortBy
    }
  ) {
    iterator
    recommendationType
    hasV1Recommendations
    hasV2Recommendations
    items {
      {d fragment with withChildren:true}   # subreddit objects with children{iterator items{post fields}}
    }
  }
}
```
Caller passes `nsfw` as `"NSFW"`/`"SFW"` (or the user's stored filter), `limit = ceil(desiredPosts/2)` with `childLimit: 2` on the home feed, `childLimit: 1` in other feeds; `includeFilters` = active category ids (`[Int!]`), `sortBy` RANDOM/TOP/HOT/NEW.

**`GetAllRecommendationsContent`** (`04ru7ve9nqpa9.js`):
```graphql
query GetAllRecommendationsContent($postId: Int!) {
  getPostRecommendations(data: {postId: $postId}) {
    subreddits {
      subredditUrl
    }
  }
}
```

**`GetPostsByCreators`** (`2skk07eulmhff.js`, items = post fragment; default `sortBy: RANDOM`, `limit: 50`):
```graphql
query GetPostsByCreators(
  $iterator: String
  $filter: GalleryFilter
  $sortBy: GallerySortBy
  $limit: Int!
  $nsfw: NsfwFilter
) {
  getPostsByCreators(
    data: {
      limit: $limit
      iterator: $iterator
      filter: $filter
      sortBy: $sortBy
      nsfw: $nsfw
    }
  ) {
    iterator
    items {
      {Z post fields}
    }
  }
}
```

**`PostsByTag`** (`2v17z4u014h5e.js`; variables spread `{nsfw:"SFW", ...}`):
```graphql
query PostsByTag($data: PostsByTagInput!) {
  getPostsByTag(data: $data) {
    iterator
    items {
      {Z post fields}
      altText
      description
      tagLinks { label url }
      hiddenTagCount
    }
  }
}
```

**`PostHiddenTags`**:
```graphql
query PostHiddenTags($postId: Int!) {
  getPostHiddenTags(postId: $postId) { label url }
}
```

**`ResolveScrolllerLinks`** (`1x889n0qsee9p.js`, full literal):
```graphql
query ResolveScrolllerLinks($urls: [String!]!) {
  resolveScrolllerLinks(urls: $urls) {
    url
    type
    post {
      id
      url
      title
      subredditId
      subredditUrl
      isPaid
      mediaSources { url width height isOptimized type }
      blurredMediaSources { url width height isOptimized type }
    }
    subreddit {
      id
      url
      title
      isPaid
      isNsfw
      previewUrl
    }
    collection {
      id
      url
      title
      description
      is_nsfw
      item_count
      previewUrl
    }
  }
}
```

### 3b. Subreddit

**`SubredditQuery`** (`2skk07eulmhff.js`; default `limit: 50`, `sortBy: RANDOM` in caller `getUserSubredditsQuery` module):
```graphql
query SubredditQuery(
  $url: String! 
  $iterator: String
  $sortBy: GallerySortBy
  $filter: GalleryFilter
  $limit: Int!
) {
  getSubreddit(data: {url: $url, iterator: $iterator, filter: $filter, limit: $limit, sortBy: $sortBy}) {
    {d fragment: withParent:opts, withChildren:opts}
  }
}
```

**`SubredditChildrenQuery`** (`2skk07eulmhff.js`):
```graphql
query SubredditChildrenQuery(
  $subredditId: Int!
  $iterator: String
  $filter: GalleryFilter
  $sortBy: GallerySortBy
  $limit: Int!
  $nsfw: NsfwFilter
) {
  getSubredditChildren(
    data: {
      subredditId: $subredditId,
      iterator: $iterator,
      filter: $filter,
      sortBy: $sortBy,
      limit: $limit,
      nsfw: $nsfw
    },
  ) {
    iterator
    items {
      {Z post fields}
    }
  }
}
```

**`SubredditPostQuery`** (`04ru7ve9nqpa9.js`; `withParent` option):
```graphql
query SubredditPostQuery(
  $url: String!
) {
  getPost(data: { url: $url }) {
    # withParent=true:
    {Z post fields} altText description tagLinks { label url } hiddenTagCount
    # withParent=false instead:
    id description tagLinks { label url } hiddenTagCount
  }
}
```

**`SearchSubredditsQuery`**:
```graphql
query SearchSubredditsQuery($query: String!, $limit: Int!, $isNsfw: Boolean!, $pageIndex: Int!) {
  searchSubreddits(
  data: {
    query: $query
    isNsfw: $isNsfw
    limit: $limit
    pageIndex: $pageIndex
  }
  ) {
    id
    title
    url
    secondary_title
    description
    is_nsfw
    item_count
    preview_images {
      url
      width
      height
    }
  }
}
```

**`SearchSubredditWithPreview`**:
```graphql
query SearchSubredditWithPreview($query: String!, $limit: Int!, $pageIndex: Int!) {
  searchSubredditWithPreview(
    data: {
      query: $query
      limit: $limit
      pageIndex: $pageIndex
    }
  ) {
    title
    secondaryTitle
    url
    isNsfw
    itemCount
    previewImage {
      url
      width
      height
    }
  }
}
```

**`getCategories`** (`1m0me3v3kcw5f.js` — 4-level nested category tree):
```graphql
query getCategories(
  $sort: String,
  $nsfw: Boolean!,
) {
  categories(
  data: {
    order_by: $sort,
    is_nsfw: $nsfw,
  }
) {
  title
  elements {
   title
   elements {
    title
    elements {
      title
      elements {
        title
      }
    }
   }
  }
} }
```

**`getCategorySubreddits`**:
```graphql
query getCategorySubreddits($categoryId: Int!) {
  getCategorySubreddits(data: {categoryId: $categoryId}) {
    subreddits {
      subredditUrl
    }  
  }
}
```

**`DiscoverFilteredSubredditsQuery`** is also used for category pages (with `includeFilters`).

**`createSubreddit`** (creator tools):
```graphql
mutation createSubreddit(
  $title: String!,
  $description: String!,
  $tags: String!,
  $isPaid: Boolean!,
  $isNsfw: Boolean!,
  $isPrivate: Boolean!
) {
  createSubreddit(
    data: {
      title: $title
      description: $description
      tags: $tags
      isPaid: $isPaid
      isNsfw: $isNsfw
      isPrivate: $isPrivate
    }
  ) {
    id
    isNsfw
    isPrivate
    username
    url
    previewUrl
    tags
    isPaid
    title
    description
  }
}
```

### 3c. Collections (user collections)

**`GetUserCollectionsQuery`**:
```graphql
query GetUserCollectionsQuery {
  getUserCollections {
    id
    title
    url
    is_nsfw
    is_private
    description
    posts {
      id
    }
  }
}
```

**`GetUserCollectionQuery`**:
```graphql
query GetUserCollectionQuery(
  $url: String!
) {
  getUserCollection(
    url: $url
  ) {
    id
    tag
    title
    url
    description
    is_private
    is_nsfw
    user_account_id
    is_following
    item_count
  }
}
```

**`GetCollectionById`** (`1x889n0qsee9p.js`):
```graphql
query GetCollectionById($collectionId: Int!) {
  getCollection(id: $collectionId) {
    id
    title
    url
    description
    is_private
    is_nsfw
    user_account_id
    item_count
    is_following
  }
}
```

**`getUserCollectionContentQuery`** (items = post fragment):
```graphql
query getUserCollectionContentQuery(
  $iterator: String
  $nsfw: NsfwFilter
  $filter: GalleryFilter
  $sortBy: GallerySortBy
  $limit: Int!
  $collectionId: Int!
  ) {
  getUserCollectionContent(
    data: {
      nsfw: $nsfw
      limit: $limit
      sortBy: $sortBy
      filter: $filter
      iterator: $iterator
      collectionId: $collectionId
    }
  ) {
    iterator
    items {
      {Z post fields}
    }
  }
}
```

**`CreateCollection`**:
```graphql
mutation CreateCollection(
  $title: String!,
  $description: String,
  $is_private: Boolean!
  $is_nsfw: Boolean!
) {
  createCollection(data: {
    title: $title,
    description: $description,
    is_private: $is_private,
    is_nsfw: $is_nsfw,
  }) {
    id
    title
    description
    url
    is_private
    is_nsfw
  }
}
```

**`EditCollection`**:
```graphql
mutation EditCollection(
  $id: Int!,
  $title: String!,
  $description: String,
  $is_private: Boolean!
  $is_nsfw: Boolean!
) {
  editCollection(data: {
    id: $id,
    title: $title,
    description: $description,
    is_private: $is_private,
    is_nsfw: $is_nsfw,
  }) {
    id
    title
    description
    url
    is_private
    is_nsfw
  }
}
```

**`DeleteCollection`**:
```graphql
mutation DeleteCollection(
  $id: Int!,
) {
  deleteCollection(data: {
    id: $id,
  })
}
```

**`AddPostToCollection`** / **`RemovePostFromCollection`**:
```graphql
mutation AddPostToCollection($postId: Int!, $collectionId: Int!) {
  addPostToCollection(data: { postId: $postId, collectionId: $collectionId })
}
mutation RemovePostFromCollection($postId: Int!, $collectionId: Int!) {
  removePostFromCollection(data: { postId: $postId, collectionId: $collectionId })
}
```

Creator-paid collection management (`0jk50ktb5z-rb.js`, `057l3veblqjgu.js`, `2re_8rociz7b4.js` — note these reuse the subreddit API):
```graphql
mutation editCustomCollection($id: Int!, $url: String!, $title: String!, $description: String, $tags: String!, $isPaid: Boolean!, $isPrivate: Boolean!) {
  editSubreddit(data: { id: $id, url: $url, title: $title, description: $description, tags: $tags, isPaid: $isPaid, isPrivate: $isPrivate }) {
    id
    previewUrl
    url
  }
}
mutation deleteCustomCollection($collectionUrl: String!) {
  deleteSubreddit(collectionUrl: $collectionUrl)
}
mutation editCollectionPreviewUrl($collectionUrl: String!, $previewUrl: String!) {
  editCollectionPreviewUrl(data: { collectionUrl: $collectionUrl, previewUrl: $previewUrl }) {
    id
    url
    previewUrl
  }
}
mutation deleteCollectionPreviewUrl($collectionId: Int!) {
  deleteCollectionPreviewUrl(collectionId: $collectionId)
}
mutation createCollectionBillingOptions($collectionId: Int!, $amount: Float!, $type: String!) {
  createCollectionBillingOptions(collectionId: $collectionId, amount: $amount, type: $type)
}
mutation delete($collectionId: Int!) {
  deactivateCollectionBillingOptions(collectionId: $collectionId)
}
```

**`PaidCollections`** (`2skk07eulmhff.js`; `isNsfw` and `limit` are **interpolated literals** — defaults `limit: 10`, `isNsfw: false`; items = `d` fragment `withChildren:false`):
```graphql
query PaidCollections(
  $iterator: String
) {
  getMyPaidCollections(
    isNsfw: <literal true|false>
    limit: <literal number>
    iterator: $iterator
  ) {
    iterator
    items {
      {d fragment withChildren:false}
    }
  }
}
```

**`getCollectionSetup`** (`2v17z4u014h5e.js`, full literal):
```graphql
query getCollectionSetup ($collectionId:Int!) {
  getCollectionSetup(collectionId:$collectionId){
    collection{
      id
      title
      description
      secondary_title
      is_paid
      user_account_id
      item_count
      video_count
      picture_count
      subscribers
    }
    offer{
      amount
      product_id
      campaign_id
      is_active
      type
      billing_model_id
    }
    owner{
      username
      avatar
      displayName
    }
    hasAccess
    status
  }
}
```

**`getCollectionSetup`-adjacent impression mutation** (`1bjhe3k_bmvvv.js`):
```graphql
mutation addCollectionImpression($subredditUrl: String, $collectionId: Int){
  addCollectionImpression(subredditUrl: $subredditUrl, collectionId: $collectionId)
}
```

### 3d. Users / follow

**`GetLoggedInUserQuery`** (full literal):
```graphql
query GetLoggedInUserQuery {
  getLoggedInUser {
    id
    username
    email
    premium_ends
    created_at
    email_verified_at
    age_verified_at
    phone_verified_at
    last_active_at
    isPremium
    socialType
    deleted_at
    hasLeaderboardEntry
    cta_closed_at
    leaderboard_visited_at
    settings{
      id
      video_autoplay
      send_sfw
      send_nsfw
      preference
      nsfw_preference
      soft_delete
      send_comment_emails
      send_message_emails
      send_newsletter
      track_watch_history
    }
    first_name
    last_name
    phone_number
    bio
    birthday
    display_name
    location
    banner_image
    avatar
    wishlist
    video_intro
    social_media {
      instagram
      twitter
      tiktok
      snapchat
      personal_website
    }
  }
}
```

**`UpdateUser`**:
```graphql
mutation UpdateUser($email: String, $username: String, $first_name: String, $last_name: String, $display_name: String, $location: String, $birthday: String, $bio: String) {
  updateUser(
    data: {
      email: $email,
      username: $username,
      first_name: $first_name,
      last_name: $last_name,
      display_name: $display_name,
      location: $location,
      birthday: $birthday,
      bio: $bio
    }
  )
}
```

**`getUserRecommendationsAvailability`** (isNsfw interpolated as literal `true`/`false`):
```graphql
query getUserRecommendationsAvailability {
  getUserRecommendationsAvailability(
    isNsfw: <literal>
  ) {
    hasV1
    hasV2
  }
}
```

**Follow queries/mutations** (`2v17z4u014h5e.js`; note the second "Follow" string actually runs `unfollow`):
```graphql
mutation Follow($url: String!) {
  follow(url: $url)
}
mutation Follow($url: String!) {
  unfollow(url: $url)
}
query GetIsFollowingSubreddit($ids: [Int!]!) {
  getIsFollowingSubreddit(ids: $ids) {
    id
    isFollowing
  }
}
query GetIsFollowingUser($id: Int, $username: String) {
  getIsFollowingUser(id: $id, username: $username) {
    isFollowing
  }
}
query GetIsFollowingUserCollection($id: Int!) {
  getIsFollowingUserCollection(id: $id)
}
query GetAllFollowingContent {
  getAllFollowingContent {
    subreddits {
      subredditUrl
    }
    collections {
      collectionUrl
    }
  }
}
query GetFollowingSubreddits ($iterator: String, $limit: Int!, $filter: GalleryFilter, $nsfw: NsfwFilter, $sortBy: GallerySortBy) {
  getFollowingSubreddits(
    data: {
      nsfw: $nsfw
      limit: $limit
      filter: $filter
      iterator: $iterator
      sortBy: $sortBy
    }
  ) {
    iterator
    items {
      {d fragment withChildren:true, isSubreddit:false (SOUND→VIDEO filter swap)}
    }
  }
}
query GetFollowingCollections ($iterator: String, $filter: GalleryFilter, $sortBy: GallerySortBy, $limit: Int!, $nsfw: NsfwFilter) {
  getFollowingCollections(
    data: {
      nsfw: $nsfw
      limit: $limit
      iterator: $iterator
      filter: $filter
      sortBy: $sortBy
    }
  ) {
    iterator
    items {
      {J fragment withChildren:true}
    }
  }
}
```

**User/reddit-user profiles** (`2skk07eulmhff.js`; items = post fragment; callers default `sortBy: RANDOM`):
```graphql
query UserPostsQuery(
  $username: String!
  $iterator: String
  $limit: Int!
  $filter: GalleryFilter
  $sortBy: GallerySortBy
  $nsfw: NsfwFilter
) {
  getUserPosts(
    data: {
      username: $username
      iterator: $iterator
      limit: $limit
      filter: $filter
      sortBy: $sortBy
      nsfw: $nsfw
    }
  ) {
    iterator
    items {
      {Z post fields}
    }
  }
}
query RedditUserPostsQuery(
  $username: String!
  $iterator: String
  $limit: Int!
  $filter: GalleryFilter
  $sortBy: GallerySortBy
  $nsfw: NsfwFilter
) {
  getRedditUserPosts(
    data: {
      username: $username
      iterator: $iterator
      limit: $limit
      filter: $filter
      sortBy: $sortBy
      nsfw: $nsfw
    }
  ) {
    iterator
    items {
      {Z post fields}
    }
  }
}
query getUserSubredditsQuery(
  $userId: Int!
) {
  getUserSubreddits(
    data: {
      userId: $userId
    }
  ) {
    id,
    url,
    title,
    secondaryTitle,
    description,
    isPaid,
    isNsfw,
    itemCount,
    preview_images {
      url
      width
      height
    }
  }
}
```

**`SearchUsersQuery`**:
```graphql
query SearchUsersQuery($query: String!, $limit: Int!, $pageIndex: Int!) {
  searchUsers(
    data: {
      query: $query
      limit: $limit
      pageIndex: $pageIndex
    }
  ) {
    id
    username
    description
    avatar
    isFollowing
    isCurrentUser
    displayName
  }
}
```

### 3e. Comments (Scrolller-side, NOT reddit-side)

Reader (`3mbbr5-x957wg.js` — module 68598, the CommentPopup):
```graphql
query getCommentsQuery($post_id: Int!, $pagination: CommentPaginationInput!) {
  getComments(
    data: {
      post_id: $post_id
      pagination: $pagination
    }
  ) {
     id
      content
      likes_count
      created_at
      updated_at
      deleted_at
      user_account {
        id
        username
        avatar
        is_premium
      }
      replies_count
      is_liked
  }
}
query getRepliesFromCommentQuery($comment_id: Int!, $pagination: CommentPaginationInput!) {
  getRepliesFromComment(
    data: {
      comment_id: $comment_id
      pagination: $pagination
    }
  ) {
      id
      content
      likes_count
      created_at
      updated_at
      deleted_at
      user_account {
        id
        username
        avatar
        is_premium
      }
      replies_count
      is_liked
    }
}
```
Both return **a plain list** (client checks `items.length < 15` / `< 3` to stop paging). Pagination values used by the site: `{limit: 15}` for top-level, `{limit: 3}` for replies, plus `cursor: <id of last comment>` for the next page.

Writer (`0h4xl5zp_z_7j.js` and duplicate `11l3z8ese83-z.js`):
```graphql
mutation createComment($content: String!, $post_id: Int!) {
  createComment(data: {content: $content, post_id: $post_id}) {
    id
    postCommentsCount
    postCommentsRepliesCount
  }
}
mutation createCommentReply($content: String!, $parent_comment_id: Int!) {
  createCommentReply(data: {content: $content, parent_comment_id: $parent_comment_id}) {
    id
    postCommentsCount
    postCommentsRepliesCount
  }
}
mutation likeComment($id: Int!) {
  likeComment(id: $id)
}
mutation unlikeComment($id: Int!) {
  unlikeComment(id: $id)
}
mutation deleteComment($id: Int!) {
  deleteComment(id: $id) {
    id
    postCommentsCount
    postCommentsRepliesCount
  }
}
mutation reportComment($commentId: Int!, $reason: String!, $details: String) {
  reportComment(data: {commentId: $commentId, reason: $reason, details: $details})
}
```

### 3f. Messages / chat

(`2skk07eulmhff.js`; message field fragment `r` is shown in section 4):
```graphql
query GetMessages($data: GetMessagesInput!) {
  getMessages(data: $data) {
    items {
      {message fields}
    }
    total
  }
}
# caller: variables {data: {other_user_id, limit, page}}
query GetConversations($data: GetConversationsInput!) {
  getConversations(data: $data) {
    items {
      user {
        id
        username
        avatar
        is_reddit_account
      }
      last_message {
        {message fields}
      }
      unread_count
    }
    next_cursor
  }
}
# caller: variables {data: {limit: 20, cursor?}}
mutation SendMessage($data: SendMessageInput!) {
  sendMessage(data: $data) {
    id
    content
    sender_id
    receiver_id
    sender {
      id
      username
      avatar
    }
    read_at
    created_at
  }
}
# caller: variables {data: {receiver_id, content}}
mutation MarkMessagesAsRead($sender_id: Int!) {
  markMessagesAsRead(sender_id: $sender_id)
}
query GetTotalUnreadCount {
  getTotalUnreadCount
}
```

**Message fields fragment** (module 957931):
```graphql
id
content
sender_id
receiver_id
sender {
  id
  username
  avatar
  is_reddit_account
}
read_at
created_at
```

### 3g. Notifications

(`1x889n0qsee9p.js`; caller passes `{pagination:{page:1, limit:30}}`; client filters `viewedAt`/`archivedAt`):
```graphql
query NotificationsQuery($data: GetNotificationsInput!) {
  getNotifications(data: $data) {
    id
    title
    content
    url
    updatedAt
    createdAt
    viewedAt
    archivedAt
  }
}
mutation markAllNotificationsAsRead {
  markAllNotificationsAsRead
}
mutation markNotificationAsArchived($id: Int!) {
  markNotificationAsArchived(id: $id)
}
mutation markNotificationAsUnarchived($id: Int!) {
  markNotificationAsUnarchived(id: $id)
}
```

### 3h. Favorites / reposts / sound (`04ru7ve9nqpa9.js`)
```graphql
mutation AddFavorite($url: String!) {
  addFavorite(url: $url)
}
mutation RemoveFavorite($url: String!) {
  removeFavorite(url: $url)
}
query GetPostIsFavorite($url: String!) {
  getPostIsFavorite(url: $url)
}
mutation RepostPost($url: String!) {
  repostPost(url: $url)
}
mutation RemoveRepost($url: String!) {
  removeRepost(url: $url)
}
mutation MarkPostWithSound($postId: Int!, $hasAudio: Boolean!) {
  addWithSound(postId: $postId, hasAudio: $hasAudio)
}
```

### 3i. Hide rules (`04ru7ve9nqpa9.js`; contentType enum POST | SUBREDDIT from module 26654)
```graphql
mutation HideContent($data: HideContentInput!) {
  hideContent(data: $data) {
    rule {
      id
      contentType
      targetId
      createdAt
    }
  }
}
mutation UnhideContent($data: UnhideContentInput!) {
  unhideContent(data: $data)
}
query GetUserHideContentRules {
  getUserHideContentRules {
    id
    contentType
    targetId
    createdAt
  }
}
query GetUserHideContentRulesWithUrl {
  getUserHideContentRulesWithUrl {
    id
    contentType
    targetId
    createdAt
    url
    subredditTitle
    isNsfw
  }
}
```

### 3j. Reports (`0z380_u4a1z8_.js`)
```graphql
mutation ReportPost($postId: Int!, $reason: String!, $details: String) {
  reportPost(data: { postId: $postId, reason: $reason, details: $details })
}
mutation ReportCollection($collectionId: Int!, $reason: String!, $details: String) {
  reportCollection(data: { collectionId: $collectionId, reason: $reason, details: $details })
}
mutation ReportUser($userId: Int!, $reason: String!, $details: String) {
  reportUser(data: { userId: $userId, reason: $reason, details: $details })
}
```

### 3k. Paid / subscriptions / payments (`112o4dm7xrxnr.js`, `0itdsdytfux99.js`)
```graphql
query PlanQuery {
  subscription_plans(orderBy:{id:asc}) {
      id
      offer_id
      product_id
      name
      billing_model_id
      interval
      amount
    }
}
# live response: plans 1..4 — Premium Monthly $14.99 (1499, interval month), Premium Yearly $47.88 (4788, year), Scrolller donation $1 (one-time), Lifetime $149.00 (14900, lifetime)
query Account {
    myAccount{
      card_last4
      card_type  
      card_exp_month
      card_exp_year 
    }
}
query Subscription {
    mySubscription{
      {subscription fields fragment _}
      collectionSubscriptions {
        {subscription fields fragment _}
        creatorName
      }
    }
}
mutation cancelSubscription ($productId: Int!, $reason: String ){
  cancelSubscription(data: { productId: $productId, reason: $reason })
}
mutation resumeSubscription ($productId: Int!){
  resumeSubscription(data: { productId: $productId })
}
mutation ChangePlan ($interval:String!){
  changePremiumPlan(data:{ interval: $interval })
}
```
Sticky.io payments (expanded with fragments N/D/s/F/g):
```graphql
mutation stickyCreatePayment (
  $action: String!, $captchaToken: String!, $offers: [Offer!]!, $tags: TagsInput
  $donationTo: String, $collectionTitle: String,
  $cardNumber: String!, $cardExpirationDate: String!, $cardCVV: String!, $freeTrial: Boolean,
) {
  stickyCreatePayment (
    data: {
      action: $action, captchaToken: $captchaToken, offers: $offers, tags: $tags,
      donationTo: $donationTo, collectionTitle: $collectionTitle,
      cardNumber: $cardNumber, cardExpirationDate: $cardExpirationDate, cardCVV: $cardCVV, freeTrial: $freeTrial,
    }
  ) {
    response_code order_id error_message
  }
}
mutation stickyCreatePaypalPayment (
  $action: String!, $captchaToken: String!, $offers: [Offer!]!, $tags: TagsInput
  $donationTo: String, $collectionTitle: String,
) {
  stickyCreatePaypalPayment (
    data: {
      action: $action, captchaToken: $captchaToken, offers: $offers, tags: $tags,
      donationTo: $donationTo, collectionTitle: $collectionTitle,
    }
  ) {
    response_code order_id error_message
    checkout_url
  }
}
mutation stickyPaymentPreviousMethod (
  $action: String!, $captchaToken: String!, $offers: [Offer!]!, $tags: TagsInput
  $donationTo: String, $collectionTitle: String,
) {
  stickyPaymentPreviousMethod(
    data: {
      action: $action, captchaToken: $captchaToken, offers: $offers, tags: $tags,
      donationTo: $donationTo, collectionTitle: $collectionTitle,
    }
  ) {
    response_code order_id error_message
  }
}
mutation stickyUpdatePaymentMethod ($captchaToken: String!, $cardNumber: String!, $cardCVV: String!, $cardExpirationDate: String!) {
  stickyUpdatePaymentMethod(data: { captchaToken: $captchaToken, cardNumber: $cardNumber, cardCVV: $cardCVV, cardExpirationDate: $cardExpirationDate })
}
mutation stickyVerifyAge ($captchaToken: String!, $cardNumber: String!, $cardExpirationDate: String!, $cardCVV: String!) {
  stickyVerifyAge(data: { captchaToken: $captchaToken, cardNumber: $cardNumber, cardExpirationDate: $cardExpirationDate, cardCVV: $cardCVV }) {
    response_code order_id error_message
  }
}
mutation createBitcoinPayment ($action: String!, $captchaToken: String!, $offers: [Offer!]!, $tags: TagsInput) {
  createBitcoinPayment(data: { action: $action, captchaToken: $captchaToken, offers: $offers, tags: $tags }) {
    checkout_url
  }
}
mutation grantPremiumAccess($order_id: Int!) {
  grantPremium(order_id: $order_id)
}
mutation grantCollectionAccess($order_id: Int!) {
  grantCollection(order_id: $order_id)
}
```

### 3l. Creator payouts & uploads
```graphql
query getRevShare{
  revShare
}
query getCreatorReport {
  getCreatorReport{
      revenueByDay{ amount day }
      revenueTotal
      revenueAvailable
      subscribersByDay{ amount day }
      subscribersTotal
      impressionsTotal
      impressionsByDay{ day amount }
      collectionImpressionsTotal
      collectionImpressionsByDay{ day amount }
      checkoutImpressionsTotal
      checkoutImpressionsByDay{ day amount }
    }
}
mutation requestWithdrawal($amount: Float!) {
  withdrawRequest(amount:$amount)
}
mutation deleteWithdrawBankAccount {
  deleteWithdrawBankAccount
}
mutation addCreatorPost($title: String!, $keywords: String!, $isNsfw: Boolean!, $mediaUrl: String!, $subredditUrl: String!, $sourceSetId: Int!, $setHeader: Boolean!, $mediaType: String!) {
  uploadPostToSubreddit(data: { title: $title, keywords: $keywords, isNsfw: $isNsfw, mediaUrl: $mediaUrl, subredditUrl: $subredditUrl, sourceSetId: $sourceSetId, setHeader: $setHeader, mediaType: $mediaType }) {
    title
    url
  }
}
mutation editPost($postId: Int!, $title: String, $keywords: String, $setAsHeader: Boolean) {
  editPost(data: { postId: $postId, title: $title, keywords: $keywords, setAsHeader: $setAsHeader }) {
    id
    isNsfw
    url
  }
}
mutation deletePost($postId: Int!) {
  deletePost(postId: $postId)
}
mutation deleteIntroVideo {
  deleteIntroVideo
}
```

### 3m. Misc / metrics / lifecycle
```graphql
mutation updateUserLastActive {
  updateUserLastActive
}
mutation updateInfo {
    updateInfo
  }
mutation setUserLeaderBoardLastClosed {
  setUserLeaderBoardLastClosed
}
# NOTE: verbatim from the bundle — the literal contains an EXTRA closing brace (source typo):
mutation setUserCTALastClosed {
    setUserCTALastClosed
  }
  }
mutation sendContentMetrics(
    $postId: Int!,
    $viewDuration: Int!,
    $replayCount: Int,
    $recommendationType: String,
    $userType: String,
    $userId: String,
    $abTestVariant: String,
    $sessionId: String
) {
    sendContentMetrics(
        data: {
            post_id: $postId,
            view_duration: $viewDuration,
            replay_count: $replayCount,
            recommendationType: $recommendationType,
            userType: $userType,
            userId: $userId,
            abTestVariant: $abTestVariant,
            sessionId: $sessionId
        }
    )
}
```
`sendContentMetrics` caller values: `userType` = `"premium"` / `"logged_in"` / `"anonymous"`; `userId` = logged-in user id or the anonymous user id; `sessionId` = `"session_<Date.now()>_<Math.random()>"`; options `{keepalive:true, includeAnonymousUserId:true}`. This mutation is the **only** consumer of the `x-anonymous-user-id` header.

Not found in any bundle (do not invent): comment-vote listing beyond `is_liked`, comment sorting options, "MarkPostWithSound" read-side, admin GraphQL schema, view-history write op (watch history is GA-linked only).

---

## 4. TYPES (fields/objects observed in selections + enums in code)

**Post (`SubredditPost`)** — full field set in fragment Z (section 3). Highlights: `fullLengthSource` (page URL of source, e.g. gfycat page), `gfycatSource`/`redgifsSource` (page URLs; literal string `"undefined"` occurs in data), `redditPath` (e.g. `/r/aww/comments/o0cr7g/cute_fox/`), `hasAudio`, `duration` (ISO-8601, e.g. `"PT5.16S"`), `userType` (`"REGULAR"`/`"CAMBUILDER"` checked in code; `null` for ordinary content), `isPaid`, `favoriteCount`, `repostCount`, `commentsCount`, `commentsRepliesCount`, `albumContent`, `mediaSources`, `blurredMediaSources`, `isFavorite`, `isReposted`, `altText`, `tagLinks {label url}`, `hiddenTagCount`.
**MediaSource**: `{url, width, height, isOptimized, type}` — `type` values observed: `"WEBP"`, `"JPEG"`, `"MP4"`, `"WEBM"` (uppercase); `isOptimized` true/false/null. Client MediaType enum (module 600213): `WEBM, MP4, JPEG, JPG, WEBP, PNG, GIF`; content class enum: `VIDEO, PICTURE`.
**Subreddit**: `__typename:"Subreddit"`, `id, url, title, secondaryTitle, description, createdAt, isNsfw, subscribers, isComplete, itemCount, videoCount, pictureCount, albumCount, isPaid, username, tags, banner, displayMedia, isFollowing, moreSubreddits, children`, plus snake_case variants in search results (`secondary_title, is_nsfw, item_count, preview_images`).
**Collection/UserCollection**: `id, tag, title, url, description, is_private, is_nsfw, user_account_id, is_following, item_count, posts, previewUrl`.
**Comment**: `id, content, likes_count, created_at, updated_at, deleted_at, user_account {id username avatar is_premium}, replies_count, is_liked`; counters on post: `postCommentsCount, postCommentsRepliesCount`.
**Message**: fragment above; conversation: `user, last_message, unread_count, next_cursor`.
**Notification**: `id, title, content, url, updatedAt, createdAt, viewedAt, archivedAt`.
**User**: `GetLoggedInUserQuery` selection + `settings` (video_autoplay, send_sfw, send_nsfw, preference, nsfw_preference, soft_delete, send_comment_emails, send_message_emails, send_newsletter, track_watch_history) + `social_media` (instagram, twitter, tiktok, snapchat, personal_website).
**Subscription**: fragment `_` + `collectionSubscriptions { ... creatorName }`; plans: `id, offer_id, product_id, name, billing_model_id, interval, amount`.
**Hide rule**: `id, contentType (POST|SUBREDDIT), targetId, createdAt, url, subredditTitle, isNsfw`.
**Client-only item types** (module 560401): `POST:"post"`, `NATIVE_AD:"native-ad"`, `MORE_SUBREDDIT:"more-subreddit"`; type-name map (module 122217): `SUBREDDIT, COLLECTION, CATEGORY, SUBREDDIT_POST, ALBUM, ALBUM_SOURCE, ITERATOR, ERROR`.
**Enums (verbatim from bundles)**:
- `GallerySortBy` (module 548699): `RANDOM, TOP, HOT, NEW, CONTROVERSIAL`. UI sort tabs for the home feed: `[RANDOM, TOP, HOT, NEW]`; default RANDOM (AB experiment may force HOT).
- `GalleryFilter` (module 44872): `CATEGORY, SUBREDDIT, ALBUM, VIDEO, PICTURE, SOUND` (SOUND requests are downgraded to VIDEO in several queries).
- `NsfwFilter`: `SFW | NSFW | ALL` (bundle literal `B=["ALL","NSFW","SFW"]`; coordinator-verified server-side).
- `RecommendationsPreference` (module 265539): `DAILY, WEEKLY, MONTHLY, EVERY_TWO_WEEKS`.
- Notifications filter: `ALL | ARCHIVED`.
- `Offer`, `TagsInput`, `RegisterUserInput`, `HideContentInput`, `UnhideContentInput`, `GetMessagesInput`, `GetConversationsInput`, `SendMessageInput`, `GetNotificationsInput`, `CommentPaginationInput`, `PostsByTagInput` exist as input objects (shapes inferred from the argument literals in each call above).

---

## 5. MEDIA URL PATTERNS

- **No client-side URL rewriting for sizes.** The API returns every variant pre-built in `mediaSources[]` (multiple entries: thumbnail webp, mid-size, jpg fallback, mp4/webm). The client picks sources by `type` (video vs picture) and `isOptimized`.
- **Hosts observed in API responses** (live-verified during this analysis):
  - `https://images.scrolller.com/zepto/<hash>_<redditname>.jpg` — original full image
  - `https://images.scrolller.com/zepto/<8hex>-<basename>-<W>x<H>.webp` — resized (observed `108x144`, `640x853`, `1080x1440`); also plain `<8hex>-<basename>.jpg` and `<hash>.png` (zepto used for UI images)
  - `https://images.scrolller.com/yocto/<slug>-480x360.webp` / `-480x360.jpg` — video thumbnails
  - `https://atto.scrolller.com/<slug>.webm` and `https://atto.scrolller.com/<slug>.mp4` — video files (slug = reddit filename + id, e.g. `the-quick-brown-fox-jumps-over-the-lazy-dog-my-6r5fise4vl`)
  - `https://static.scrolller.com/profiles/avatar/<id>.webp` — avatars; `static.scrolller.com/neutron/…` (legacy rewrite target)
  - `https://photon.scrolller.com/...` — site-owned static assets (logos, affiliate/NSFW-warning mp4s, ad creatives)
  - `https://helios.scrolller.com/cambuilder/preview_<hash>.mp4`, `video_<hash>.mp4`; thumbs at `images.scrolller.com/helios/cambuilder/thumb_<hash>.webp` — webcam/creator content
  - `https://quark.scrolller.com/<id>.mp4` — ad/native-ad video
- **Legacy rewrites in bundle code** (module 37972, `112o4dm7xrxnr.js`): if a `.jpg/.png/.webp` URL's subdomain isn't `photon`: `redgifs.`→`//images.scrolller.com/proton/`, `gfycat.`→`//images.scrolller.com/proton/`; otherwise `neutron.scrolller.com/`→`static.scrolller.com/neutron/`, and (non-image case) redgifs/gfycat→`//static.scrolller.com/proton/`. The old `/5000x5000/no-extension/`, `/gif/`, `/mp4/` path segments from the legacy API do **not** appear in this build or in current responses.
- **Audio**: no separate audio URL. Audio lives in the mp4/webm; `hasAudio` on the post is metadata the client detects itself (`webkitAudioDecodedByteCount`/`mozHasAudio`/`audioTracks`) and reports back via `MarkPostWithSound` (`addWithSound`).
- **Downloads**: no signed URLs, no content-disposition logic, no rate-limit code anywhere in the bundles. Paid content: when `post.isPaid` and `mediaSources === null`, the client falls back to `blurredMediaSources` (DisplayMedia `isBlurred` logic). The unlock button just routes to the premium/checkout funnel (`/premium` or `/collection-checkout/*`).
- Reddit external page URLs are kept in `fullLengthSource`/`gfycatSource`/`redgifsSource`/`redditPath` (page links, not media).

---

## 6. PAGINATION & FILTERS

| Query | Pagination | Values used by the site |
|---|---|---|
| `discoverFilteredSubreddits` | opaque `iterator` string; `limit` (subreddits/page) + `childLimit` (posts per subreddit) | home: `childLimit:2`, `limit=ceil(N/2)`; category views `childLimit:1`; iterator examples: `"2977"`, `"2397"` (single int), children iterator `"764925172;2147432983"` (two ints joined by `;`) |
| `getSubreddit` | `iterator` + `limit` (default 50) + `filter` + `sortBy`; children come embedded (children have NO server-side args) | `"RANDOM"` default sortBy |
| `getSubredditChildren` | `iterator`, `limit`, `filter`, `sortBy`, `nsfw` | used for infinite scroll; limit 50 in the bundled template example |
| `getUserPosts` / `getRedditUserPosts` / `getPostsByCreators` | `iterator` + `limit` + `filter` + `sortBy` + `nsfw` | creator page: `limit: 2*perPage`, `iterator: ""` (empty string = start!), `nsfw:"ALL"`, `sortBy RANDOM` |
| `getUserCollectionContent` | `iterator`, `limit`, `filter`, `sortBy`, `nsfw`, `collectionId` | |
| `getFollowingSubreddits` / `getFollowingCollections` | each has own `iterator`; the site merges them client-side into `<collectionIter>++<followIter>` (each part is `"null"` when exhausted) | default limit 10 |
| `getMyPaidCollections` | `iterator`; `limit`/`isNsfw` interpolated literals | limit 10 |
| `searchSubreddits` / `searchCollections` | **`pageIndex` (offset page number)** + `limit` + `query` + `isNsfw` | autocomplete uses `limit: 50, pageIndex: 0` |
| `searchSubredditWithPreview` / `searchUsers` | `pageIndex` + `limit` + `query` | |
| `getComments` / `getRepliesFromComment` | `pagination: {limit, cursor}` — cursor = **last comment id** | limit 15 (top-level), 3 (replies); stop when returned length < limit |
| `getNotifications` | `pagination: {page, limit}` (numeric page) | `{page:1, limit:30}` |
| `getMessages` | `{other_user_id, limit, page}` (numeric page) | |
| `getConversations` | `{limit, cursor?}` (opaque cursor from `next_cursor`) | limit 20 |
| `categories` | `order_by` (string sort) + `is_nsfw` | |
| filters everywhere | `filter: GalleryFilter` (CATEGORY/SUBREDDIT/ALBUM/VIDEO/PICTURE/SOUND), `sortBy: GallerySortBy`, `nsfw: NsfwFilter` | SOUND→VIDEO swap in two callers; `includeFilters`/`excludeFilters` = category id arrays (`[Int!]`) |
| searchQuery | the `query:` field of the search* inputs (plain string) | there is NO global `searchQuery`/`subredditFilter`/`catFilter` gallery filter in this build — search is a separate query family |

**No `timeFilter` of any kind exists** (no `Trending`/`Popular` strings either — sorting is the `GallerySortBy` enum).

---

## 7. WEBSOCKET / REALTIME

- **No WebSocket usage at all.** No `wss://`, no `new WebSocket`, no EventSource, no socket.io in any of the 118 chunks or the HTML.
- Chat/messages = plain GraphQL + `setInterval` polling of `GetTotalUnreadCount` every **30 s** (`startUnreadPolling`), conversations/messages fetched on open.
- Metrics = GraphQL mutation `sendContentMetrics` (keepalive fetch, anonymous-id header) + GA4/Meta Pixel; ads carry a click `adUrl` (`trk.scrolller.com/<uuid>`) and a `viewableImpressionUrl` (null in observed payloads).

---

## 8. RISK NOTES

1. **Auth is in the body**: a client MUST send `"authorization": "<token>"` as a top-level JSON body field (not a header). Anonymous = `null`. No cookies needed for the API.
2. **reCAPTCHA v2 invisible** (sitekey `6LeJvwAiAAAAAKsG0MNtphyMm1sDjC0CcGopiowd`) is required server-side for: `registerUser`, `forgetPassword`, `stickyCreatePayment`, `stickyUpdatePaymentMethod`, `stickyVerifyAge`, `updateUserPhoneNumber`, `twilioVerifyGetNewCode`, `sendVerifyEmail`. Login needs none.
3. **Rate-limit hints**: nothing explicit in the client. The only timeouts are a dead 10 s `AbortSignal.timeout` path and axios defaults. The endpoint moved to `/admin` (an "admin-looking" path) which is almost certainly deliberate obfuscation against naive scrapers — keep a browser-like `User-Agent`; the site itself sends `accept: */*`.
4. **Strict-ish GraphQL validation**: server rejects unknown fields (live-verified: `audioSourceUrl`/`fullLengthSourceUrl` do NOT exist on `SubredditPost` — the real names are `fullLengthSource`, etc.; `blurredMediaSources` does not exist on `AlbumContentOutput`). Introspection is disabled (per coordinator verification) — build queries from this document only. `includeFilters: null` on `discoverFilteredSubreddits` caused an INTERNAL_SERVER_ERROR — omit the variable instead of sending null.
5. **Unused variables**: several documents define variables they don't use (e.g. `SubredditQuery`'s `$iterator/$sortBy/$filter/$limit` when the `d`-fragment children carry no args) — the server tolerates them; a client can safely reuse the exact texts.
6. **Paid/NSFW gating**: `blurredMediaSources` + `isPaid` fallback; NSFW blur replaced by a placeholder image client-side when filter is on. There is no signed-URL protection on media hosts.
7. `setUserCTALastClosed` contains a literal stray `}` in the shipped source (works as sent because the client sends it verbatim — replicate exactly if reusing the text).

---

## 9. FILES ANALYZED

Original 37 homepage chunks (all read; GraphQL/feature map):
- `1nh9bs67l4tet.js` — **GraphQL client module 490665** (`fetch(o.c)`), config module 58785 (`/admin`, upload host8, reCAPTCHA keys, GA ids), login store (module 265539, `SCROLLLER_BETA_1:SCROLLLER_LOGIN_DEV`, token expiry), anonymous id, GA watch-session linker
- `112o4dm7xrxnr.js` — GetLoggedInUserQuery, RegisterQuery, RenewLoginToken, UpdateUser, updateUserLastActive, PlanQuery, Account, Subscription, getUserRecommendationsAvailability; session-restore logic; media URL rewrite helpers (module 37972); route enum
- `33ful7xcc-m8h.js` — **fragment builder module 82742** (J/Z/d/_/N/s/D/F/g)
- `04ru7ve9nqpa9.js` — AddFavorite, RemoveFavorite, RepostPost, RemoveRepost, GetPostIsFavorite, GetAllRecommendationsContent, HideContent/UnhideContent/rules, SubredditPostQuery
- `2v17z4u014h5e.js` — Follow/unfollow, GetFollowing*, GetIsFollowing*, GetUserCollectionsQuery, DiscoverFilteredSubredditsQuery, PostsByTag, PostHiddenTags, getCollectionSetup, getCreatorReport, MarkPostWithSound; GallerySortBy/GalleryFilter enums
- `2skk07eulmhff.js` — SubredditQuery, SubredditChildrenQuery, searches, UserPostsQuery/RedditUserPostsQuery/getRevShare/getUserSubredditsQuery, PaidCollections, getUserCollectionContentQuery/GetUserCollectionQuery, GetPostsByCreators, messages/chat set; message fragment; unread polling
- `1x889n0qsee9p.js` — NotificationsQuery + 3 notification mutations, updateInfo, GetCollectionById, ResolveScrolllerLinks, env console.logs, home-feed glue
- `0spiqpbz-59-p.js` — sendContentMetrics, fullscreen viewer, comment popup trigger
- `0t6lx7ruaws-p.js` — setUserCTALastClosed (stray brace), setUserLeaderBoardLastClosed
- `1yecr252jf5_7.js` — trk.scrolller.com tracking domain, premium CTA guids
- `1qww1asagtyt1.js` — theme module 74944 (no API)
- `0cz1d0mv5g_q7.js`, `1u6187342xcay.js`, `1wmab19j-8gcm.js`, `0h4jbp1ea1chq.js`, `1ts_zo-yftz1m.js`, `0_guih9kp32en.js`, `2i50pwisa_6u-.js`, `turbopack-3-fww4g9y__l3.js`, and the small chunks — React/framework/runtime, chunk registry (`1z8aiwez1hxfl.js`), home feed glue (`0_guih9kp32en.js`), Reddit about.json fallback + hide-rule store (`2skk07eulmhff.js`)

**Extra files downloaded during this task** (all into the same `bundles/` dir, plus 2 HTML pages in the parent dir):
- 81 lazy chunks referenced by the registry (`0-z0wpblcuvfk.js` … `454t_fbx8x02m.js`, re-downloaded with the correct `/_next/static/` prefix after an initial bad-path attempt)
- From `https://scrolller.com/r/aww` and `https://scrolller.com/login`: `bundles/1bjhe3k_bmvvv.js` (subreddit hydration + addCollectionImpression), `bundles/2qivmmsd6-fcw.js` (feed wrapper), `bundles/3efs3_gp6fraz.js` (feed UI copy); `r-subreddit.html`, `login.html`, `index-current.html`
- Key lazy chunks with operations: `3mbbr5-x957wg.js` (CommentPopup: getCommentsQuery/getRepliesFromCommentQuery), `0h4xl5zp_z_7j.js` + `11l3z8ese83-z.js` (comment mutations), `2tu3a32gpwctq.js` (LoginQuery/ForgetPasswordQuery + login UI + ReCaptcha wrapper), `228dnf-7mo_5t.js` (Create/AddPost/RemovePost collection), `2-1y3ge2xg6vn.js` (EditCollection), `3y2k7exv2f5xa.js` (DeleteCollection), `057l3veblqjgu.js`, `2re_8rociz7b4.js`, `0jk50ktb5z-rb.js`, `04u85k4br0cqx.js`, `0itdsdytfux99.js`, `0aicbr4rtkurd.js`, `1m76xjwgjcf0l.js`, `1uah_s56jz3ig.js`, `23ja0ij4o94m8.js`, `15n9dyoka7qls.js`, `1amxkjldiyulp.js`, `1m0me3v3kcw5f.js`, `0z380_u4a1z8_.js`, `04dk90lrwy2lz.js` (axios + `PUT https://host8.scrolller.com/upload` multipart helper: FormData fields `content`, `file_key`, optional `blur`, optional `Authorization`; response `{url, sourceSetId}`)

Supporting JSON probes saved during endpoint verification: `sub-aww.json`, `sub-aww2.json`, `sub-aww3.json`, `sub-aww4.json`, `post-fox.json`, `disc-video*.json` in the same tmp dir.