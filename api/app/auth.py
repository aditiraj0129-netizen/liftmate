import time

from fastapi import Header, HTTPException

from app.db import supabase

# Remember checked tokens for a few minutes so every request (and every voice clip)
# doesn't wait for a round trip to Supabase.
_TOKEN_CACHE: dict[str, tuple[str, float]] = {}
_CACHE_SECONDS = 300


def current_user_id(authorization: str = Header(default="")) -> str:
    """
    The web app sends "Authorization: Bearer <token>" with every request.
    We ask Supabase who owns that token. If nobody does, the request is rejected.
    """
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Please log in again.")
    token = authorization.split(" ", 1)[1]

    cached = _TOKEN_CACHE.get(token)
    if cached and cached[1] > time.time():
        return cached[0]

    try:
        result = supabase.auth.get_user(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Your login has expired. Please log in again.")
    if not result or not result.user:
        raise HTTPException(status_code=401, detail="Please log in again.")

    if len(_TOKEN_CACHE) > 5000:
        _TOKEN_CACHE.clear()
    _TOKEN_CACHE[token] = (result.user.id, time.time() + _CACHE_SECONDS)
    return result.user.id
