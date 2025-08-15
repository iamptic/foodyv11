# Foody backend (FastAPI) — v10 auth/merchant + sequence hotfix
import os
import re
import mimetypes
from uuid import uuid4
from typing import Dict, Any, Optional, List
from datetime import datetime, timezone

import asyncpg
from fastapi import FastAPI, UploadFile, File, HTTPException, Body, Request, Response
from fastapi.middleware.cors import CORSMiddleware

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError

# ====== ENV ======
DATABASE_URL = os.environ.get("DATABASE_URL")
CORS_ORIGINS = [o.strip() for o in (os.environ.get("CORS_ORIGINS") or "").split(",") if o.strip()] or ["*"]
RUN_MIGRATIONS = bool(int(os.environ.get("RUN_MIGRATIONS", "1")))

# Cloudflare R2
R2_ENDPOINT = os.environ.get("R2_ENDPOINT")
R2_BUCKET = os.environ.get("R2_BUCKET")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY")

# ====== Password hashing ======
try:
    import bcrypt  # type: ignore
    def hash_password(p: str) -> str:
        return bcrypt.hashpw(p.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    def verify_password(p: str, h: str) -> bool:
        try:
            return bcrypt.checkpw(p.encode("utf-8"), h.encode("utf-8"))
        except Exception:
            return False
    HASHER = "bcrypt"
except Exception:
    import hashlib, hmac
    _SALT = os.environ.get("PW_SALT", "foody_dev_salt")
    def hash_password(p: str) -> str:
        return hashlib.sha256((_SALT + p).encode("utf-8")).hexdigest()
    def verify_password(p: str, h: str) -> bool:
        return h == hash_password(p)
    HASHER = "sha256"

def normalize_login(s: str) -> str:
    s = (s or "").strip()
    if "@" in s:
        return s.lower()
    return re.sub(r"\D+", "", s)  # digits only for phone

def gen_api_key() -> str:
    return uuid4().hex + uuid4().hex  # 64 hex chars

app = FastAPI(title="Foody API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_pool: Optional[asyncpg.Pool] = None

# ====== DB bootstrap/migrations ======
async def _initialize(conn: asyncpg.Connection):
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS merchants (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          address TEXT,
          phone TEXT,
          email TEXT,
          password_hash TEXT,
          api_key TEXT UNIQUE,
          auth_login TEXT UNIQUE, -- normalized login (email lower OR phone digits)
          lat DOUBLE PRECISION,
          lng DOUBLE PRECISION,
          close_time TIME,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS offers (
          id SERIAL PRIMARY KEY,
          merchant_id INT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          description TEXT,
          category TEXT,
          price NUMERIC(12,2) NOT NULL,
          original_price NUMERIC(12,2),
          qty_total INT,
          qty_left INT,
          stock INT,
          image_url TEXT NOT NULL,
          expires_at TIMESTAMPTZ NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_offers_expires ON offers(expires_at);
        CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);
        """
    )

async def _migrate_auth(conn: asyncpg.Connection):
    stmts = [
        "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS email TEXT",
        "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS password_hash TEXT",
        "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS api_key TEXT",
        "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS auth_login TEXT",
        "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION",
        "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION",
        "ALTER TABLE merchants ADD COLUMN IF NOT EXISTS close_time TIME",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_merchants_api_key ON merchants(api_key)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_merchants_auth_login ON merchants(auth_login)",
        # offers compatibility
        "ALTER TABLE offers ADD COLUMN IF NOT EXISTS original_price NUMERIC(12,2)",
        "ALTER TABLE offers ADD COLUMN IF NOT EXISTS qty_total INT",
        "ALTER TABLE offers ADD COLUMN IF NOT EXISTS qty_left INT",
        "ALTER TABLE offers ADD COLUMN IF NOT EXISTS stock INT",
    ]
    for q in stmts:
        try:
            await conn.execute(q)
        except Exception:
            pass

async def _fix_sequences(conn: asyncpg.Connection):
    # Align sequences with current max(id) to prevent duplicate key on id=1
    try:
        await conn.execute(
            "SELECT setval(pg_get_serial_sequence('merchants','id'), COALESCE((SELECT MAX(id) FROM merchants), 0))"
        )
    except Exception:
        pass
    try:
        await conn.execute(
            "SELECT setval(pg_get_serial_sequence('offers','id'), COALESCE((SELECT MAX(id) FROM offers), 0))"
        )
    except Exception:
        pass

async def _ensure(conn: asyncpg.Connection):
    if RUN_MIGRATIONS:
        await _initialize(conn)
        await _migrate_auth(conn)
        await _fix_sequences(conn)

@app.on_event("startup")
async def pool():
    global _pool
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL missing")
    _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
    async with _pool.acquire() as conn:
        await _ensure(conn)

@app.get("/health")
async def health():
    return {"ok": True, "hasher": HASHER}

# ====== R2 client / URL helpers ======
def _r2_client():
    if not all([R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY]):
        raise RuntimeError("R2 env not configured")
    return boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        config=BotoConfig(signature_version="s3v4"),
        region_name="auto",
    )

NO_PHOTO_URL = "https://placehold.co/800x600/png?text=Foody"

def _r2_public_url(key: str) -> str:
    try:
        host = (R2_ENDPOINT or "").split("//", 1)[-1]
        account = host.split(".", 1)[0]
        return f"https://pub-{account}.r2.dev/{R2_BUCKET}/{key}"
    except Exception:
        return f"{(R2_ENDPOINT or '').rstrip('/')}/{R2_BUCKET}/{key}"

# ====== Upload image to R2 ======
@app.post("/upload")
async def upload(file: UploadFile = File(...)):
    try:
        ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
        if ext not in [".jpg", ".jpeg", ".png", ".webp"]:
            raise HTTPException(status_code=400, detail="Unsupported image type")

        content = await file.read()
        key = f"offers/{uuid4().hex}{ext}"

        s3 = _r2_client()
        content_type = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"

        s3.put_object(
            Bucket=R2_BUCKET,
            Key=key,
            Body=content,
            ContentType=content_type,
        )
        return {"url": _r2_public_url(key)}
    except (BotoCoreError, ClientError) as e:
        raise HTTPException(status_code=500, detail=f"R2 error: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")

def _parse_expires_at(value: str) -> datetime:
    if not value:
        raise HTTPException(status_code=400, detail="expires_at is empty")
    value = value.strip()
    try:
        dt = datetime.strptime(value, "%Y-%m-%d %H:%M")
        return dt.replace(tzinfo=timezone.utc)
    except ValueError:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt

# ====== Legacy create offer (compat) ======
@app.post("/merchant/offers")
async def legacy_create_offer(payload: Dict[str, Any] = Body(...)):
    try:
        required = ["title", "price", "stock", "expires_at"]
        for r in required:
            if r not in payload or (str(payload[r]).strip() == ""):
                raise HTTPException(status_code=400, detail=f"Field {r} is required")

        merchant_id = int(payload.get("merchant_id") or 1)
        image_url = (payload.get("image_url") or "").strip() or NO_PHOTO_URL
        expires_at_dt = _parse_expires_at(payload.get("expires_at"))

        async with _pool.acquire() as conn:
            # detect columns for compatibility
            cols = await conn.fetch("SELECT column_name FROM information_schema.columns WHERE table_name='offers'")
            colset = {c["column_name"] for c in cols}
            has_stock = "stock" in colset

            if has_stock:
                row = await conn.fetchrow(
                    """
                    INSERT INTO offers
                      (merchant_id, title, description, price, stock, category, image_url, expires_at, status, created_at)
                    VALUES
                      ($1,$2,$3,$4,$5,COALESCE($6,'other'),$7,$8,'active',NOW())
                    RETURNING id
                    """,
                    merchant_id,
                    payload.get("title"),
                    payload.get("description"),
                    float(payload.get("price")),
                    int(payload.get("stock")),
                    payload.get("category"),
                    image_url,
                    expires_at_dt,
                )
            else:
                qty = int(payload.get("stock"))
                row = await conn.fetchrow(
                    """
                    INSERT INTO offers
                      (merchant_id, title, description, price, qty_total, qty_left, category, image_url, expires_at, status, created_at)
                    VALUES
                      ($1,$2,$3,$4,$5,$6,COALESCE($7,'other'),$8,$9,'active',NOW())
                    RETURNING id
                    """,
                    merchant_id,
                    payload.get("title"),
                    payload.get("description"),
                    float(payload.get("price")),
                    qty, qty,
                    payload.get("category"),
                    image_url,
                    expires_at_dt,
                )
            return {"offer_id": row["id"]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Create offer failed: {e}")

# ====== Public offers ======
@app.get("/public/offers")
async def public_offers():
    async with _pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT o.id, o.title, o.description, o.price, o.category,
                   COALESCE(o.qty_left, o.stock) AS qty_left,
                   COALESCE(o.qty_total, o.stock) AS qty_total,
                   o.image_url, o.expires_at, o.status,
                   m.id AS merchant_id, m.name AS merchant_name, m.address
            FROM offers o
            JOIN merchants m ON m.id = o.merchant_id
            WHERE o.status = 'active'
              AND o.expires_at > NOW()
              AND COALESCE(o.qty_left, o.stock, 0) > 0
            ORDER BY o.expires_at ASC
            LIMIT 200
            """
        )
        return [dict(r) for r in rows]

# =====================================================
# New: API v1 with proper registration & login
# =====================================================

async def _require_auth(conn: asyncpg.Connection, restaurant_id: int, api_key: str):
    row = await conn.fetchrow(
        "SELECT id FROM merchants WHERE id=$1 AND api_key=$2",
        restaurant_id, api_key
    )
    if not row:
        raise HTTPException(status_code=401, detail="Invalid credentials")

@app.post("/api/v1/merchant/register_public")
async def register_public(payload: Dict[str, Any] = Body(...)):
    name = (payload.get("name") or "").strip()
    login = normalize_login((payload.get("login") or payload.get("phone") or payload.get("email") or "").strip())
    password = (payload.get("password") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if not login:
        raise HTTPException(status_code=400, detail="phone or email is required")
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="password must be at least 6 chars")

    api_key = gen_api_key()
    pwd_hash = hash_password(password)

    async with _pool.acquire() as conn:
        exists = await conn.fetchval("SELECT 1 FROM merchants WHERE auth_login=$1", login)
        if exists:
            raise HTTPException(status_code=409, detail="merchant already exists")

        phone, email = (None, None)
        if "@" in login:
            email = login
        else:
            phone = login

        row = await conn.fetchrow(
            """
            INSERT INTO merchants (name, phone, email, password_hash, api_key, auth_login, created_at)
            VALUES ($1,$2,$3,$4,$5,$6, NOW())
            RETURNING id, api_key
            """,
            name, phone, email, pwd_hash, api_key, login
        )
        return {"restaurant_id": row["id"], "api_key": row["api_key"]}

@app.post("/api/v1/merchant/login")
async def merchant_login(payload: Dict[str, Any] = Body(...)):
    login = normalize_login(payload.get("login") or "")
    password = (payload.get("password") or "").strip()
    if not login or not password:
        raise HTTPException(status_code=400, detail="login and password are required")

    async with _pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id, password_hash, api_key FROM merchants WHERE auth_login=$1",
            login
        )
        if not row or not row["password_hash"] or not verify_password(password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="invalid login or password")
        return {"restaurant_id": row["id"], "api_key": row["api_key"]}

@app.get("/api/v1/merchant/profile")
async def get_profile(restaurant_id: int, request: Request):
    api_key = request.headers.get("X-Foody-Key") or request.headers.get("x-foody-key") or ""
    async with _pool.acquire() as conn:
        await _require_auth(conn, restaurant_id, api_key)
        row = await conn.fetchrow(
            """
            SELECT id, name, phone, email, address, lat, lng, close_time
            FROM merchants WHERE id=$1
            """,
            restaurant_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="not found")
        d = dict(row)
        if isinstance(d.get("close_time"), datetime):
            d["close_time"] = d["close_time"].strftime("%H:%M")
        return d

@app.put("/api/v1/merchant/profile")
async def update_profile(payload: Dict[str, Any] = Body(...), request: Request = None):
    restaurant_id = int(payload.get("restaurant_id") or 0)
    if not restaurant_id:
        raise HTTPException(status_code=400, detail="restaurant_id required")
    api_key = ""
    if request:
        api_key = request.headers.get("X-Foody-Key") or request.headers.get("x-foody-key") or ""
    async with _pool.acquire() as conn:
        await _require_auth(conn, restaurant_id, api_key)
        name = (payload.get("name") or "").strip() or None
        phone = (payload.get("phone") or "").strip() or None
        address = (payload.get("address") or "").strip() or None
        lat = payload.get("lat", None)
        lng = payload.get("lng", None)
        close_time = payload.get("close_time", None)
        await conn.execute(
            """
            UPDATE merchants SET
                name = COALESCE($2,name),
                phone = COALESCE($3,phone),
                address = COALESCE($4,address),
                lat = COALESCE($5,lat),
                lng = COALESCE($6,lng),
                close_time = COALESCE($7,close_time)
            WHERE id = $1
            """,
            restaurant_id, name, phone, address, lat, lng, close_time
        )
        return {"ok": True}

def _price_cents_to_num(v: Any) -> float:
    try:
        return round((int(v) or 0) / 100.0, 2)
    except Exception:
        return 0.0

def _num_to_cents(v: Any) -> int:
    try:
        return int(round(float(v) * 100))
    except Exception:
        return 0

@app.get("/api/v1/merchant/offers")
async def list_my_offers(restaurant_id: int, request: Request):
    api_key = request.headers.get("X-Foody-Key") or request.headers.get("x-foody-key") or ""
    async with _pool.acquire() as conn:
        await _require_auth(conn, restaurant_id, api_key)
        rows = await conn.fetch(
            """
            SELECT id, title, description, category, image_url, expires_at,
                   price, original_price,
                   COALESCE(qty_total, stock) AS qty_total,
                   COALESCE(qty_left, stock)  AS qty_left
            FROM offers
            WHERE merchant_id=$1
            ORDER BY created_at DESC
            """,
            restaurant_id,
        )
        items = []
        for r in rows:
            d = dict(r)
            d["price_cents"] = _num_to_cents(d.pop("price", 0))
            d["original_price_cents"] = _num_to_cents(d.pop("original_price", 0))
            items.append(d)
        return items

@app.get("/api/v1/merchant/offers/csv")
async def export_offers_csv(restaurant_id: int, request: Request):
    api_key = request.headers.get("X-Foody-Key") or request.headers.get("x-foody-key") or ""
    async with _pool.acquire() as conn:
        await _require_auth(conn, restaurant_id, api_key)
        rows = await conn.fetch(
            """
            SELECT id, title, description, category, image_url, expires_at,
                   price, original_price,
                   COALESCE(qty_total, stock) AS qty_total,
                   COALESCE(qty_left, stock)  AS qty_left
            FROM offers
            WHERE merchant_id=$1
            ORDER BY created_at DESC
            """,
            restaurant_id,
        )
        import csv
        from io import StringIO
        buf = StringIO()
        w = csv.writer(buf)
        w.writerow(["id","title","price","original_price","qty_left","qty_total","expires_at","category","image_url"])
        for r in rows:
            w.writerow([r["id"], r["title"], r["price"], r["original_price"], r["qty_left"], r["qty_total"], r["expires_at"].isoformat(), r["category"], r["image_url"]])
        data = buf.getvalue().encode("utf-8")
        return Response(content=data, media_type="text/csv")

@app.post("/api/v1/merchant/offers")
async def create_offer_api(payload: Dict[str, Any] = Body(...), request: Request = None):
    restaurant_id = int(payload.get("restaurant_id") or 0)
    if not restaurant_id:
        raise HTTPException(status_code=400, detail="restaurant_id required")
    api_key = ""
    if request:
        api_key = request.headers.get("X-Foody-Key") or request.headers.get("x-foody-key") or ""
    async with _pool.acquire() as conn:
        await _require_auth(conn, restaurant_id, api_key)

        title = (payload.get("title") or "").strip()
        if not title:
            raise HTTPException(status_code=400, detail="title required")

        price = payload.get("price")
        price_cents = payload.get("price_cents")
        if price is None and price_cents is None:
            raise HTTPException(status_code=400, detail="price or price_cents required")
        if price is None:
            price = _price_cents_to_num(price_cents)

        original_price = payload.get("original_price")
        original_price_cents = payload.get("original_price_cents")
        if original_price is None and original_price_cents is not None:
            original_price = _price_cents_to_num(original_price_cents)

        qty_total = int(payload.get("qty_total") or payload.get("stock") or 1)
        qty_left = int(payload.get("qty_left") or qty_total)

        image_url = (payload.get("image_url") or "").strip() or NO_PHOTO_URL
        expires_at_dt = _parse_expires_at(payload.get("expires_at"))

        row = await conn.fetchrow(
            """
            INSERT INTO offers
              (merchant_id, title, description, category, image_url, expires_at,
               price, original_price, qty_total, qty_left, status, created_at, stock)
            VALUES ($1,$2,$3,COALESCE($4,'other'),$5,$6,$7,$8,$9,$10,'active', NOW(), $11)
            RETURNING id
            """,
            restaurant_id, title, payload.get("description"), payload.get("category"),
            image_url, expires_at_dt, float(price), float(original_price or 0), qty_total, qty_left, qty_left
        )
        return {"offer_id": row["id"]}

# Optional alias for upload under /api/v1
@app.post("/api/v1/upload")
async def upload_alias(file: UploadFile = File(...)):
    return await upload(file)
