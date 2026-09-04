import { platformAdapters, type PlatformId } from '@/lib/platform-adapters';
import { customerSafeColors, customerSafeSizes, isPendingProductFact } from '@/lib/product-facts';

export type ProductInput = {
  name: string;
  sku: string;
  category: string;
  color: string;
  size: string;
  material: string;
  priceCents: number;
  stock: number;
  /** The listing state observed in the merchant backend. Omitted for manual imports. */
  listingStatus?: 'active' | 'out_of_stock' | 'off_shelf';
};

export type Product = ProductInput & {
  id: string;
  shopId: string;
  status: 'active' | 'out_of_stock' | 'off_shelf';
  updatedAt: number;
};

export type SourceProductInput = {
  sourceUrl: string;
  sourceTitle: string;
  shopSaleCents: number;
  externalSku: string;
};

export type SourceProduct = SourceProductInput & {
  id: string;
  sourceProductId: string;
  status: 'pending' | 'enriched' | 'needs_authorization' | 'failed';
  knowledgeStatus: 'pending' | 'confirmed';
  material: string;
  specifications: string;
  attributes: Record<string, string>;
  sellingPoints: string;
  imageUrl: string;
  sourcePriceCents: number | null;
  linkedProductId: string | null;
  linkedProductName: string;
  linkedProductSku: string;
  recommendedProductId: string | null;
  recommendedProductName: string;
  matchConfidence: number | null;
  updatedAt: number;
};

export type CollectedSourceFacts = {
  status: 'enriched' | 'needs_authorization' | 'failed';
  title?: string;
  material?: string;
  specifications?: string;
  attributes?: Record<string, string>;
  sellingPoints?: string;
  imageUrl?: string;
  sourcePriceCents?: number | null;
};

export type CollectedSourceProductInput = SourceProductInput & Omit<CollectedSourceFacts, 'status'> & {
  collectionStatus: CollectedSourceFacts['status'];
};

/** Facts safe for customer-service retrieval: collected, reviewed, and linked. */
export type ConfirmedProductKnowledge = {
  productId: string;
  productName: string;
  sku: string;
  color: string;
  size: string;
  sourceProductId: string;
  sourceTitle: string;
  material: string;
  specifications: string;
  attributes: Record<string, string>;
  sellingPoints: string;
  updatedAt: number;
};

export type ProductDetailKnowledge = {
  sku: string;
  productId: string | null;
  productName: string;
  category: string;
  material: string;
  specifications: string;
  attributes: Record<string, string>;
  colors: string;
  sizes: string;
  conflicts: string[];
  status: 'pending' | 'confirmed';
  updatedAt: number;
};

export type ProductDetailKnowledgeInput = {
  sku: string;
  productName: string;
  category?: string;
  material?: string;
  specifications?: string;
  attributes?: Record<string, string>;
  colors?: string;
  sizes?: string;
  conflicts?: string[];
};

export type ShopConnection = {
  id: string;
  merchantId: string;
  name: string;
  platform: 'douyin' | 'taobao' | 'jd' | 'pdd' | 'other';
  connector: 'local_browser' | 'official_api' | 'manual_import';
  status: 'ready' | 'waiting' | 'paused';
  lastSyncAt: number | null;
};

export type MerchantWorkspace = {
  id: string;
  displayName: string;
  email: string;
  createdAt: number;
};

export type MerchantShopScope = {
  merchant: MerchantWorkspace;
  shop: ShopConnection;
};

export type SecurityActivity = { id: string; action: string; createdAt: number; shopId: string | null };
export type StoreSyncProduct = { sku: string; name: string; priceCents: number; stock: number; listingStatus: 'active' | 'out_of_stock' | 'off_shelf' };
export type SyncRun = { id: string; platform: string; scope: string; sourceTotal: number; processed: number; status: 'completed' | 'failed'; detail: string; createdAt: number };

export type ConnectorCatalogItem = {
  platform: PlatformId;
  name: string;
  availability: 'ready' | 'planned';
  preferredConnector: ShopConnection['connector'];
  capability: string;
  productFlow: string;
  messageFlow: string;
  connectionRequirement: string;
};

const shopId = 'demo-douyin-womens-shoes';
const localMerchantId = 'local-merchant-owner';

const connectorCatalog: ConnectorCatalogItem[] = platformAdapters.map((adapter) => ({
  ...adapter,
  preferredConnector: adapter.platform === 'other' ? 'manual_import' : 'local_browser',
  capability: adapter.platform === 'douyin' ? '商品同步、飞鸽消息草稿与安全回复' : '复用商品同步、知识审核、消息草稿与人工接管规范',
}));

const createShopsTable = `CREATE TABLE IF NOT EXISTS shops (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  connector TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  last_sync_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;

const createMerchantsTable = `CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  owner_auth_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;

const createProductsTable = `CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  color TEXT NOT NULL,
  size TEXT NOT NULL,
  material TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  stock INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  updated_at INTEGER NOT NULL
)`;

const createConversationsTable = `CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  last_message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;

const createMessagesTable = `CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
)`;

const createHandoffTicketsTable = `CREATE TABLE IF NOT EXISTS handoff_tickets (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
)`;

const createConnectorActionsTable = `CREATE TABLE IF NOT EXISTS connector_actions (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  type TEXT NOT NULL,
  draft_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  error_text TEXT NOT NULL DEFAULT ''
)`;

const createSourceProductsTable = `CREATE TABLE IF NOT EXISTS source_products (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_product_id TEXT NOT NULL,
  source_title TEXT NOT NULL,
  shop_sale_cents INTEGER NOT NULL,
  external_sku TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;

const createKnowledgeEntriesTable = `CREATE TABLE IF NOT EXISTS knowledge_entries (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  source_product_id TEXT NOT NULL,
  title TEXT NOT NULL,
  material TEXT NOT NULL DEFAULT '',
  specifications TEXT NOT NULL DEFAULT '',
  attributes_json TEXT NOT NULL DEFAULT '{}',
  selling_points TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  source_price_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  updated_at INTEGER NOT NULL
)`;

const createProductSourceLinksTable = `CREATE TABLE IF NOT EXISTS product_source_links (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  source_product_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  confidence INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;

const createProductDetailKnowledgeTable = `CREATE TABLE IF NOT EXISTS product_detail_knowledge (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  product_id TEXT,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  material TEXT NOT NULL DEFAULT '',
  specifications TEXT NOT NULL DEFAULT '',
  attributes_json TEXT NOT NULL DEFAULT '{}',
  colors TEXT NOT NULL DEFAULT '',
  sizes TEXT NOT NULL DEFAULT '',
  conflicts_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  updated_at INTEGER NOT NULL
)`;

const createSecurityActivityTable = `CREATE TABLE IF NOT EXISTS security_activity (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  shop_id TEXT,
  actor_auth_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
)`;

const createSyncRunsTable = `CREATE TABLE IF NOT EXISTS sync_runs (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  scope TEXT NOT NULL,
  source_total INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
)`;

const initialProducts: ProductInput[] = [
  { name: '轻便单鞋', sku: 'SHOE-BLK-36', category: '女鞋', color: '黑色', size: '36', material: '超纤', priceCents: 19900, stock: 12 },
  { name: '浅口乐福鞋', sku: 'SHOE-BEI-37', category: '女鞋', color: '米色', size: '37', material: '头层牛皮', priceCents: 23900, stock: 0 },
];

export async function ensureCatalogSchema(db: D1Database) {
  await db.batch([
    db.prepare(createMerchantsTable),
    db.prepare(createShopsTable),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_merchants_owner_auth ON merchants(owner_auth_id)'),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_shops_merchant_platform_name ON shops(merchant_id, platform, name)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_shops_merchant_updated ON shops(merchant_id, updated_at)'),
    db.prepare(createProductsTable),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_shop_sku ON products(shop_id, sku)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_products_shop_status ON products(shop_id, status)'),
    db.prepare(createConversationsTable),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_conversations_shop_updated ON conversations(shop_id, updated_at)'),
    db.prepare(createMessagesTable),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at)'),
    db.prepare(createHandoffTicketsTable),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_handoff_tickets_status_created ON handoff_tickets(status, created_at)'),
    db.prepare(createConnectorActionsTable),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_connector_actions_shop_status ON connector_actions(shop_id, status, created_at)'),
    db.prepare(createSourceProductsTable),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_source_products_shop_source_id ON source_products(shop_id, source_product_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_source_products_shop_updated ON source_products(shop_id, updated_at)'),
    db.prepare(createKnowledgeEntriesTable),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_entries_shop_source_id ON knowledge_entries(shop_id, source_product_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_knowledge_entries_shop_status ON knowledge_entries(shop_id, status)'),
    db.prepare(createProductSourceLinksTable),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_product_source_links_shop_source ON product_source_links(shop_id, source_product_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_product_source_links_shop_product ON product_source_links(shop_id, product_id)'),
    db.prepare(createProductDetailKnowledgeTable),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_product_detail_knowledge_shop_sku ON product_detail_knowledge(shop_id, sku)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_product_detail_knowledge_shop_status ON product_detail_knowledge(shop_id, status)'),
    db.prepare(createSecurityActivityTable),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_security_activity_merchant_created ON security_activity(merchant_id, created_at)'),
    db.prepare(createSyncRunsTable),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_sync_runs_shop_created ON sync_runs(shop_id, created_at)'),
  ]);
  // Existing shops already have this table. Add the flexible attribute field once,
  // while keeping old material/specification records completely usable.
  try {
    await db.prepare("ALTER TABLE knowledge_entries ADD COLUMN attributes_json TEXT NOT NULL DEFAULT '{}'").run();
  } catch {
    // SQLite reports a duplicate-column error after the first migration; that is safe.
  }

  const now = Date.now();
  await db.prepare(
    `INSERT OR IGNORE INTO shops (id, merchant_id, name, platform, connector, status, last_sync_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(shopId, localMerchantId, '示例鞋履店', 'douyin', 'local_browser', 'ready', now, now, now).run();

  const count = await db.prepare('SELECT COUNT(*) AS total FROM products WHERE shop_id = ?').bind(shopId).first<{ total: number }>();
  if ((count?.total ?? 0) > 0) return;

  await db.batch(initialProducts.map((product, index) => db.prepare(
    `INSERT INTO products (id, shop_id, sku, name, category, color, size, material, price_cents, stock, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    `seed-${index + 1}`,
    shopId,
    product.sku,
    product.name,
    product.category,
    product.color,
    product.size,
    product.material,
    product.priceCents,
    product.stock,
    product.stock > 0 ? 'active' : 'out_of_stock',
    now,
  )));
}

function mapMerchantWorkspace(row: Record<string, unknown>): MerchantWorkspace {
  return { id: String(row.id), displayName: String(row.display_name), email: String(row.email), createdAt: Number(row.created_at) };
}

/**
 * Private Sites provide this identity after ChatGPT sign-in. The first verified owner
 * claims the existing local workspace; later identities receive no data by default.
 */
export async function getMerchantWorkspace(db: D1Database, headers: Headers) {
  const authId = headers.get('oai-authenticated-user-id')?.trim();
  if (!authId) return null;
  await ensureCatalogSchema(db);
  const existing = await db.prepare('SELECT * FROM merchants WHERE owner_auth_id = ?').bind(authId).first<Record<string, unknown>>();
  if (existing) return mapMerchantWorkspace(existing);

  const localWorkspace = await db.prepare('SELECT * FROM merchants WHERE id = ?').bind(localMerchantId).first<Record<string, unknown>>();
  // Preserve the first merchant and its existing store data. Later signed-in
  // users receive a clean independent workspace instead of sharing it.
  if (localWorkspace) {
    const email = headers.get('oai-authenticated-user-email')?.trim() || '';
    const id = `merchant-${crypto.randomUUID()}`;
    const now = Date.now();
    await db.prepare(
      'INSERT INTO merchants (id, owner_auth_id, display_name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(id, authId, email || '新商家', email, now, now).run();
    return { id, displayName: email || '新商家', email, createdAt: now } satisfies MerchantWorkspace;
  }

  const email = headers.get('oai-authenticated-user-email')?.trim() || '';
  const now = Date.now();
  await db.prepare(
    'INSERT INTO merchants (id, owner_auth_id, display_name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(localMerchantId, authId, '示例鞋履店', email, now, now).run();
  return { id: localMerchantId, displayName: '示例鞋履店', email, createdAt: now } satisfies MerchantWorkspace;
}

function mapShopConnection(row: Record<string, unknown>): ShopConnection {
  const platform = ['douyin', 'taobao', 'jd', 'pdd', 'other'].includes(String(row.platform)) ? String(row.platform) as ShopConnection['platform'] : 'other';
  const connector = ['local_browser', 'official_api', 'manual_import'].includes(String(row.connector)) ? String(row.connector) as ShopConnection['connector'] : 'manual_import';
  const status = ['ready', 'waiting', 'paused'].includes(String(row.status)) ? String(row.status) as ShopConnection['status'] : 'waiting';
  return {
    id: String(row.id), merchantId: String(row.merchant_id), name: String(row.name), platform, connector, status,
    lastSyncAt: row.last_sync_at === null || row.last_sync_at === undefined ? null : Number(row.last_sync_at),
  };
}

/** The dashboard currently selects the local merchant. Every data query is scoped by its shop_id. */
export async function listShopConnections(db: D1Database, merchantId = localMerchantId) {
  await ensureCatalogSchema(db);
  const result = await db.prepare('SELECT * FROM shops WHERE merchant_id = ? ORDER BY updated_at DESC').bind(merchantId).all<Record<string, unknown>>();
  return result.results.map(mapShopConnection);
}

export async function createShopConnection(db: D1Database, merchantId: string, input: Pick<ShopConnection, 'name' | 'platform' | 'connector'>) {
  await ensureCatalogSchema(db);
  const now = Date.now();
  const id = `shop-${crypto.randomUUID()}`;
  await db.prepare(
    `INSERT INTO shops (id, merchant_id, name, platform, connector, status, last_sync_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'waiting', NULL, ?, ?)`,
  ).bind(id, merchantId, input.name.trim(), input.platform, input.connector, now, now).run();
  return { id, merchantId, name: input.name.trim(), platform: input.platform, connector: input.connector, status: 'waiting', lastSyncAt: null } satisfies ShopConnection;
}

/** Resolves a requested shop only after proving that it belongs to the signed-in merchant. */
export async function resolveMerchantShopScope(db: D1Database, headers: Headers, requestedShopId?: string | null): Promise<MerchantShopScope | null> {
  const merchant = await getMerchantWorkspace(db, headers);
  if (!merchant) return null;
  const shops = await listShopConnections(db, merchant.id);
  const shop = requestedShopId ? shops.find((item) => item.id === requestedShopId) : shops[0];
  return shop ? { merchant, shop } : null;
}

/** Stores only operational metadata; messages, credentials and costs never enter this log. */
export async function recordSecurityActivity(db: D1Database, input: { merchantId: string; shopId?: string | null; actorAuthId: string; action: string; targetId?: string }) {
  await ensureCatalogSchema(db);
  await db.prepare(
    'INSERT INTO security_activity (id, merchant_id, shop_id, actor_auth_id, action, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(crypto.randomUUID(), input.merchantId, input.shopId || null, input.actorAuthId, input.action.slice(0, 80), input.targetId?.slice(0, 120) || '', Date.now()).run();
}

export async function listSecurityActivity(db: D1Database, merchantId: string, activeShopId?: string | null) {
  await ensureCatalogSchema(db);
  const result = activeShopId
    ? await db.prepare('SELECT id, action, created_at, shop_id FROM security_activity WHERE merchant_id = ? AND shop_id = ? ORDER BY created_at DESC LIMIT 50').bind(merchantId, activeShopId).all<Record<string, unknown>>()
    : await db.prepare('SELECT id, action, created_at, shop_id FROM security_activity WHERE merchant_id = ? ORDER BY created_at DESC LIMIT 50').bind(merchantId).all<Record<string, unknown>>();
  return result.results.map((row) => ({ id: String(row.id), action: String(row.action), createdAt: Number(row.created_at), shopId: row.shop_id ? String(row.shop_id) : null })) satisfies SecurityActivity[];
}

export function listConnectorCatalog() {
  return connectorCatalog;
}

function mapProduct(row: Record<string, unknown>): Product {
  const baseColor = String(row.base_color ?? row.color ?? '');
  const baseSize = String(row.base_size ?? row.size ?? '');
  const baseMaterial = String(row.base_material ?? row.material ?? '');
  const confirmedColor = customerSafeColors(String(row.confirmed_colors ?? ''));
  const confirmedSize = customerSafeSizes(String(row.confirmed_sizes ?? ''));
  const confirmedMaterial = String(row.confirmed_material ?? '').trim();
  const color = confirmedColor || customerSafeColors(baseColor) || '待核实';
  const size = confirmedSize || customerSafeSizes(baseSize) || '待核实';
  const material = !isPendingProductFact(confirmedMaterial) ? confirmedMaterial : (isPendingProductFact(baseMaterial) ? '待核实' : baseMaterial);
  return {
    id: String(row.id), shopId: String(row.shop_id), sku: String(row.sku), name: String(row.name),
    category: String(row.category), color, size, material,
    priceCents: Number(row.price_cents), stock: Number(row.stock),
    status: row.status === 'off_shelf' ? 'off_shelf' : row.status === 'out_of_stock' ? 'out_of_stock' : 'active', updatedAt: Number(row.updated_at),
  };
}

export async function listProducts(db: D1Database, activeShopId = shopId) {
  await ensureCatalogSchema(db);
  const result = await db.prepare(
    `SELECT products.id, products.shop_id, products.sku, products.name, products.category,
       products.color AS base_color, products.size AS base_size, products.material AS base_material,
       product_detail_knowledge.colors AS confirmed_colors,
       product_detail_knowledge.sizes AS confirmed_sizes,
       product_detail_knowledge.material AS confirmed_material,
       products.price_cents, products.stock, products.status, products.updated_at
     FROM products
     LEFT JOIN product_detail_knowledge
       ON product_detail_knowledge.shop_id = products.shop_id
       AND product_detail_knowledge.sku = products.sku
       AND product_detail_knowledge.status = 'confirmed'
       AND product_detail_knowledge.conflicts_json = '[]'
     WHERE products.shop_id = ?
     ORDER BY products.updated_at DESC`,
  ).bind(activeShopId).all<Record<string, unknown>>();
  return result.results.map(mapProduct);
}

export async function createProduct(db: D1Database, product: ProductInput, activeShopId = shopId) {
  await ensureCatalogSchema(db);
  const id = crypto.randomUUID();
  const now = Date.now();
  const status = product.listingStatus === 'off_shelf' ? 'off_shelf' : product.stock > 0 ? 'active' : 'out_of_stock';
  await db.prepare(
    `INSERT INTO products (id, shop_id, sku, name, category, color, size, material, price_cents, stock, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, activeShopId, product.sku, product.name, product.category, product.color, product.size, product.material, product.priceCents, product.stock, status, now).run();
  return { id, shopId: activeShopId, ...product, status, updatedAt: now } satisfies Product;
}

export async function importProducts(db: D1Database, products: ProductInput[], activeShopId = shopId) {
  await ensureCatalogSchema(db);
  const latestBySku = new Map(products.map((product) => [product.sku, product]));
  const rows = [...latestBySku.values()];
  const now = Date.now();
  await db.batch(rows.map((product) => db.prepare(
    `INSERT INTO products (id, shop_id, sku, name, category, color, size, material, price_cents, stock, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(shop_id, sku) DO UPDATE SET
       name = excluded.name,
       category = CASE WHEN excluded.category IN ('', '待补充', '女鞋') THEN products.category ELSE excluded.category END,
       color = CASE WHEN excluded.color IN ('', '待补充') THEN products.color ELSE excluded.color END,
       size = CASE WHEN excluded.size IN ('', '待补充') THEN products.size ELSE excluded.size END,
       material = CASE WHEN excluded.material IN ('', '待补充') THEN products.material ELSE excluded.material END,
       price_cents = excluded.price_cents, stock = excluded.stock,
       status = excluded.status, updated_at = excluded.updated_at`,
  ).bind(
    crypto.randomUUID(), activeShopId, product.sku, product.name, product.category, product.color, product.size,
    product.material, product.priceCents, product.stock, product.listingStatus === 'off_shelf' ? 'off_shelf' : product.stock > 0 ? 'active' : 'out_of_stock', now,
  )));
  return rows.length;
}

/** Stores only listing facts read from the merchant's own product list. Existing reviewed fields are retained. */
export async function syncStoreListings(db: D1Database, items: StoreSyncProduct[], input: { platform: string; scope: string; sourceTotal: number }, activeShopId = shopId) {
  await ensureCatalogSchema(db);
  const latest = new Map(items.map((item) => [item.sku.trim(), item]));
  const rows = [...latest.values()];
  const now = Date.now();
  await db.batch(rows.map((item) => db.prepare(
    `INSERT INTO products (id, shop_id, sku, name, category, color, size, material, price_cents, stock, status, updated_at)
     VALUES (?, ?, ?, ?, '待同步', '待补充', '待补充', '待补充', ?, ?, ?, ?)
     ON CONFLICT(shop_id, sku) DO UPDATE SET
       name = excluded.name, price_cents = excluded.price_cents, stock = excluded.stock,
       status = excluded.status, updated_at = excluded.updated_at`,
  ).bind(crypto.randomUUID(), activeShopId, item.sku.trim(), item.name.trim(), item.priceCents, item.stock, item.listingStatus, now)));
  const run: SyncRun = {
    id: crypto.randomUUID(), platform: input.platform, scope: input.scope, sourceTotal: Math.max(0, input.sourceTotal),
    processed: rows.length, status: 'completed',
    detail: rows.length ? '已读取商品标题、货号、售价、库存和上架状态；材质、颜色、尺码仍需从商品详情审核后进入知识库。' : '未读取到完整商品行。',
    createdAt: now,
  };
  await db.prepare(
    'INSERT INTO sync_runs (id, shop_id, platform, scope, source_total, processed, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(run.id, activeShopId, run.platform, run.scope, run.sourceTotal, run.processed, run.status, run.detail, run.createdAt).run();
  return run;
}

/** Removes only the replaceable store-listing snapshot and unreviewed detail captures for one shop. */
export async function resetStoreSyncSnapshot(db: D1Database, activeShopId = shopId) {
  await ensureCatalogSchema(db);
  const result = await db.batch([
    db.prepare("DELETE FROM product_detail_knowledge WHERE shop_id = ? AND status = 'pending'").bind(activeShopId),
    db.prepare("DELETE FROM products WHERE shop_id = ? AND category = '待同步'").bind(activeShopId),
  ]);
  return { pendingDetailsRemoved: Number(result[0]?.meta?.changes || 0), listingsRemoved: Number(result[1]?.meta?.changes || 0) };
}

export async function listSyncRuns(db: D1Database, activeShopId = shopId) {
  await ensureCatalogSchema(db);
  const result = await db.prepare(
    'SELECT id, platform, scope, source_total, processed, status, detail, created_at FROM sync_runs WHERE shop_id = ? ORDER BY created_at DESC LIMIT 20',
  ).bind(activeShopId).all<Record<string, unknown>>();
  return result.results.map((row) => ({
    id: String(row.id), platform: String(row.platform), scope: String(row.scope), sourceTotal: Number(row.source_total), processed: Number(row.processed),
    status: row.status === 'failed' ? 'failed' : 'completed', detail: String(row.detail || ''), createdAt: Number(row.created_at),
  })) satisfies SyncRun[];
}

export async function updateProductStock(db: D1Database, id: string, stock: number, activeShopId = shopId) {
  await ensureCatalogSchema(db);
  const now = Date.now();
  const result = await db.prepare(
    "UPDATE products SET stock = ?, status = ?, updated_at = ? WHERE id = ? AND shop_id = ?",
  ).bind(stock, stock > 0 ? 'active' : 'out_of_stock', now, id, activeShopId).run();
  if (!result.meta.changes) return null;
  return db.prepare('SELECT * FROM products WHERE id = ? AND shop_id = ?').bind(id, activeShopId).first<Record<string, unknown>>().then((row) => row ? mapProduct(row) : null);
}

export async function deleteProduct(db: D1Database, id: string, activeShopId = shopId) {
  await ensureCatalogSchema(db);
  const result = await db.prepare('DELETE FROM products WHERE id = ? AND shop_id = ?').bind(id, activeShopId).run();
  return result.meta.changes > 0;
}

/**
 * Removes the nine records created by the former SKU migration rule.  This is
 * deliberately an exact, fail-closed cleanup rather than a general-purpose
 * duplicate remover: if the reviewed set changes, no record is deleted.
 */
const verifiedLegacyProductSkus = [
  '1048437197534', '1062891001579', '956417020571', '1047612582104',
  '814544545319', '876609792295', '960472592782', 'SHOE-BLK-36', 'SHOE-BEI-37',
];

export async function cleanupVerifiedLegacyProducts(db: D1Database, activeShopId = shopId) {
  await ensureCatalogSchema(db);
  const placeholders = verifiedLegacyProductSkus.map(() => '?').join(', ');
  const result = await db.prepare(
    `SELECT id, sku, name FROM products WHERE shop_id = ? AND sku IN (${placeholders})`,
  ).bind(activeShopId, ...verifiedLegacyProductSkus).all<Record<string, unknown>>();
  const legacyProducts = result.results;
  if (legacyProducts.length !== verifiedLegacyProductSkus.length) {
    return { state: 'review_required' as const, found: legacyProducts.length };
  }

  // The one confirmed detail capture belongs to the older SKU. Move it to its
  // current listing before deleting the retired product row.
  const detailMoves: Array<{ legacySku: string; currentId: string; currentSku: string; currentName: string }> = [];
  for (const legacy of legacyProducts) {
    const legacySku = String(legacy.sku);
    const detail = await db.prepare(
      'SELECT id FROM product_detail_knowledge WHERE shop_id = ? AND sku = ?',
    ).bind(activeShopId, legacySku).first<Record<string, unknown>>();
    if (!detail) continue;
    const current = await db.prepare(
      `SELECT id, sku, name FROM products
       WHERE shop_id = ? AND name = ? AND sku <> ?
       ORDER BY updated_at DESC LIMIT 1`,
    ).bind(activeShopId, String(legacy.name), legacySku).first<Record<string, unknown>>();
    if (!current) return { state: 'review_required' as const, found: legacyProducts.length };
    const existingDetail = await db.prepare(
      'SELECT id FROM product_detail_knowledge WHERE shop_id = ? AND sku = ?',
    ).bind(activeShopId, String(current.sku)).first<Record<string, unknown>>();
    if (existingDetail) return { state: 'review_required' as const, found: legacyProducts.length };
    detailMoves.push({ legacySku, currentId: String(current.id), currentSku: String(current.sku), currentName: String(current.name) });
  }

  const changes = [
    ...detailMoves.map((move) => db.prepare(
      `UPDATE product_detail_knowledge
       SET sku = ?, product_id = ?, product_name = ?, updated_at = ?
       WHERE shop_id = ? AND sku = ?`,
    ).bind(move.currentSku, move.currentId, move.currentName, Date.now(), activeShopId, move.legacySku)),
    ...legacyProducts.map((product) => db.prepare(
      'DELETE FROM products WHERE id = ? AND shop_id = ?',
    ).bind(String(product.id), activeShopId)),
  ];
  await db.batch(changes);
  return { state: 'cleaned' as const, removed: legacyProducts.length, knowledgeMoved: detailMoves.length };
}

function sourceProductIdFromUrl(sourceUrl: string) {
  const matched = sourceUrl.match(/(?:offer\/|detail\.1688\.com\/offer\/)(\d+)/i);
  return matched?.[1] ?? '';
}

function normalizeAttributes(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .slice(0, 30)
    .map(([key, item]) => [String(key).trim().slice(0, 40), String(item ?? '').trim().slice(0, 240)])
    .filter(([key, item]) => key && item));
}

function readAttributes(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return {};
  try { return normalizeAttributes(JSON.parse(value)); } catch { return {}; }
}

function normalizeConflicts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))].slice(0, 10);
}

function readConflicts(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return [];
  try { return normalizeConflicts(JSON.parse(value)); } catch { return []; }
}

function mapProductDetailKnowledge(row: Record<string, unknown>): ProductDetailKnowledge {
  return {
    sku: String(row.sku), productId: row.product_id ? String(row.product_id) : null,
    productName: String(row.product_name), category: String(row.category ?? ''), material: String(row.material ?? ''),
    specifications: String(row.specifications ?? ''), attributes: readAttributes(row.attributes_json),
    // 详情页的规格区会混入“上移 / 下移”等编辑按钮文案。详情资料、
    // 后台展示和客服知识库必须使用同一份可回答的颜色与尺码，不能把操作词带给商家或客户。
    colors: customerSafeColors(String(row.colors ?? '')), sizes: customerSafeSizes(String(row.sizes ?? '')), conflicts: readConflicts(row.conflicts_json),
    status: row.status === 'confirmed' ? 'confirmed' : 'pending', updatedAt: Number(row.updated_at),
  };
}

export function validProductDetailKnowledge(value: unknown): value is ProductDetailKnowledgeInput {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.sku === 'string' && /^\d{6,}$/.test(item.sku.trim())
    && typeof item.productName === 'string' && item.productName.trim().length > 0;
}

export async function importProductDetailKnowledge(db: D1Database, entries: ProductDetailKnowledgeInput[], activeShopId = shopId) {
  await ensureCatalogSchema(db);
  const latest = new Map(entries.map((entry) => [entry.sku.trim(), entry]));
  const rows = [...latest.values()];
  const products = await listProducts(db, activeShopId);
  const productsBySku = new Map(products.map((product) => [product.sku, product]));
  const now = Date.now();
  await db.batch(rows.map((entry) => {
    const sku = entry.sku.trim();
    const product = productsBySku.get(sku);
    return db.prepare(
      `INSERT INTO product_detail_knowledge (id, shop_id, sku, product_id, product_name, category, material, specifications, attributes_json, colors, sizes, conflicts_json, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
       ON CONFLICT(shop_id, sku) DO UPDATE SET
         product_id = excluded.product_id, product_name = excluded.product_name, category = excluded.category,
         material = excluded.material, specifications = excluded.specifications, attributes_json = excluded.attributes_json,
         colors = excluded.colors, sizes = excluded.sizes, conflicts_json = excluded.conflicts_json,
         status = 'pending', updated_at = excluded.updated_at`,
    ).bind(
      crypto.randomUUID(), activeShopId, sku, product?.id ?? null, entry.productName.trim(), entry.category?.trim() || '',
      entry.material?.trim() || '', entry.specifications?.trim() || '', JSON.stringify(normalizeAttributes(entry.attributes)),
      customerSafeColors(entry.colors), customerSafeSizes(entry.sizes), JSON.stringify(normalizeConflicts(entry.conflicts)), now,
    );
  }));
  return rows.length;
}

export async function listProductDetailKnowledge(db: D1Database, activeShopId = shopId) {
  await ensureCatalogSchema(db);
  const result = await db.prepare(
    'SELECT * FROM product_detail_knowledge WHERE shop_id = ? ORDER BY updated_at DESC LIMIT 500',
  ).bind(activeShopId).all<Record<string, unknown>>();
  return result.results.map(mapProductDetailKnowledge);
}

export async function confirmProductDetailKnowledge(db: D1Database, sku: string, activeShopId = shopId) {
  await ensureCatalogSchema(db);
  const result = await db.prepare(
    "UPDATE product_detail_knowledge SET status = 'confirmed', updated_at = ? WHERE shop_id = ? AND sku = ?",
  ).bind(Date.now(), activeShopId, sku).run();
  if (!result.meta.changes) return null;
  const row = await db.prepare('SELECT * FROM product_detail_knowledge WHERE shop_id = ? AND sku = ?').bind(activeShopId, sku).first<Record<string, unknown>>();
  return row ? mapProductDetailKnowledge(row) : null;
}

/** Confirms only conflict-free detail records. Conflicted entries must remain for manual review. */
export async function confirmPendingProductDetailKnowledge(db: D1Database, activeShopId = shopId) {
  await ensureCatalogSchema(db);
  const result = await db.prepare(
    "UPDATE product_detail_knowledge SET status = 'confirmed', updated_at = ? WHERE shop_id = ? AND status = 'pending' AND conflicts_json = '[]'",
  ).bind(Date.now(), activeShopId).run();
  return result.meta.changes ?? 0;
}

function sourceSizeText(value: string) {
  const sizes = [...new Set((value.match(/\b(?:[3-4]\d)\b/g) ?? []))];
  return sizes.length >= 2 ? sizes.join('、') : '';
}

function replaceSizeInSpecifications(specifications: string, sizes: string) {
  if (!sizes) return specifications;
  if (/尺码[：:]/.test(specifications)) return specifications.replace(/尺码[：:][^；;]+/, `尺码：${sizes}`);
  return [specifications, `尺码：${sizes}`].filter(Boolean).join('；');
}

/** Resolves a reviewed conflict by making the already-confirmed linked source authoritative. */
export async function resolveProductDetailWithConfirmedSource(db: D1Database, sku: string) {
  await ensureCatalogSchema(db);
  const detail = await db.prepare(
    'SELECT * FROM product_detail_knowledge WHERE shop_id = ? AND sku = ?',
  ).bind(shopId, sku).first<Record<string, unknown>>();
  if (!detail) return null;
  const source = await db.prepare(
    `SELECT knowledge_entries.material, knowledge_entries.specifications
     FROM products
     JOIN product_source_links ON product_source_links.product_id = products.id AND product_source_links.shop_id = products.shop_id
     JOIN knowledge_entries ON knowledge_entries.source_product_id = product_source_links.source_product_id AND knowledge_entries.shop_id = product_source_links.shop_id
     WHERE products.shop_id = ? AND products.sku = ? AND knowledge_entries.status = 'confirmed'
     ORDER BY knowledge_entries.updated_at DESC LIMIT 1`,
  ).bind(shopId, sku).first<Record<string, unknown>>();
  if (!source) return { state: 'source_not_confirmed' as const };

  const material = String(source.material ?? '').trim() || String(detail.material ?? '');
  const sourceSizes = sourceSizeText(String(source.specifications ?? ''));
  const attributes = readAttributes(detail.attributes_json);
  for (const [key, value] of Object.entries(attributes)) {
    if (/(材质|面料)/.test(key) && material && value !== material) delete attributes[key];
  }
  const now = Date.now();
  await db.prepare(
    `UPDATE product_detail_knowledge
     SET material = ?, specifications = ?, attributes_json = ?, sizes = ?, conflicts_json = '[]', status = 'confirmed', updated_at = ?
     WHERE shop_id = ? AND sku = ?`,
  ).bind(
    material, replaceSizeInSpecifications(String(detail.specifications ?? ''), sourceSizes), JSON.stringify(attributes),
    sourceSizes || String(detail.sizes ?? ''), now, shopId, sku,
  ).run();
  return { state: 'resolved' as const, material, sizes: sourceSizes || String(detail.sizes ?? '') };
}

function mapSourceProduct(row: Record<string, unknown>, products: Product[]): SourceProduct {
  const status = String(row.status);
  const sourceTitle = String(row.source_title);
  const sourceMaterial = String(row.material ?? '');
  const sourceSpecifications = String(row.specifications ?? '');
  const attributes = readAttributes(row.attributes_json);
  const linkedProductId = row.linked_product_id ? String(row.linked_product_id) : null;
  const recommendation = linkedProductId ? null : recommendProduct({
    sourceTitle, sourceMaterial, sourceSpecifications, externalSku: String(row.external_sku),
    sourceProductId: String(row.source_product_id),
  }, products);
  return {
    id: String(row.id), sourceUrl: String(row.source_url), sourceProductId: String(row.source_product_id),
    sourceTitle, shopSaleCents: Number(row.shop_sale_cents), externalSku: String(row.external_sku),
    status: status === 'enriched' || status === 'needs_authorization' || status === 'failed' ? status : 'pending',
    knowledgeStatus: row.knowledge_status === 'confirmed' ? 'confirmed' : 'pending', updatedAt: Number(row.updated_at),
    material: sourceMaterial, specifications: sourceSpecifications, attributes, sellingPoints: String(row.selling_points ?? ''),
    imageUrl: String(row.image_url ?? ''), sourcePriceCents: row.source_price_cents === null || row.source_price_cents === undefined ? null : Number(row.source_price_cents),
    linkedProductId, linkedProductName: String(row.linked_product_name ?? ''), linkedProductSku: String(row.linked_product_sku ?? ''),
    recommendedProductId: recommendation?.id ?? null, recommendedProductName: recommendation?.name ?? '', matchConfidence: recommendation?.confidence ?? null,
  };
}

function normalizedText(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * A collected 1688 label is not automatically a customer-facing material.
 * Search tags such as “增高、透气、防滑” are frequently returned in the
 * material field by listing pages and must never become an answer to a buyer.
 */
function customerSafeMaterial(value: string) {
  const material = String(value ?? '').trim();
  if (!material) return false;
  if (/^(增高|透气|防滑|休闲|时尚|百搭|舒适|新款|女鞋)([，,、/\s]*(增高|透气|防滑|休闲|时尚|百搭|舒适|新款|女鞋))*$/u.test(material)) return false;
  return /(真皮|牛皮|羊皮|猪皮|麂皮|超纤|合成革|太空革|PU|PVC|EVA|橡胶|网布|帆布|绒|革|皮质)/iu.test(material);
}

/** A manual or automatic link still needs a meaningful product-title overlap. */
function longestSharedTitleFragment(left: string, right: string) {
  const a = normalizedText(left);
  const b = normalizedText(right);
  let longest = 0;
  for (let start = 0; start < a.length; start += 1) {
    for (let end = start + 1; end <= a.length; end += 1) {
      const length = end - start;
      if (length <= longest) continue;
      if (b.includes(a.slice(start, end))) longest = length;
    }
  }
  return longest;
}

function customerSafeSourceKnowledge(row: Record<string, unknown>) {
  const productName = String(row.product_name ?? '');
  const sourceTitle = String(row.source_title ?? '');
  const material = String(row.material ?? '');
  // Imported move-history SKU values can be reused or wrong, so a “100%” link
  // score alone is not customer-safe. Require a clear visible-title overlap.
  const titleRelated = longestSharedTitleFragment(productName, sourceTitle) >= 6;
  return customerSafeMaterial(material) && titleRelated;
}

function recommendProduct(source: { sourceTitle: string; sourceMaterial: string; sourceSpecifications: string; externalSku: string; sourceProductId: string }, products: Product[]) {
  const sourceText = normalizedText(`${source.sourceTitle} ${source.sourceMaterial} ${source.sourceSpecifications}`);
  const sourceSkus = [source.externalSku, source.sourceProductId].map(normalizedText).filter(Boolean);
  const ranked = products.map((product) => {
    const name = normalizedText(product.name);
    const sku = normalizedText(product.sku);
    let confidence = sourceSkus.includes(sku) ? 100 : 0;
    if (name.length >= 2 && (sourceText.includes(name) || name.includes(sourceText))) confidence += 65;
    if (product.color && sourceText.includes(normalizedText(product.color))) confidence += 15;
    if (product.size && sourceText.includes(normalizedText(product.size))) confidence += 10;
    if (product.material && sourceText.includes(normalizedText(product.material))) confidence += 10;
    return { id: product.id, name: product.name, confidence: Math.min(confidence, 100) };
  }).sort((left, right) => right.confidence - left.confidence);
  return ranked[0] && ranked[0].confidence >= 40 ? ranked[0] : null;
}

export function validSourceProduct(value: unknown): value is SourceProductInput {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const url = typeof item.sourceUrl === 'string' ? item.sourceUrl.trim() : '';
  return /^https:\/\/detail\.1688\.com\/offer\/\d+/i.test(url)
    && typeof item.sourceTitle === 'string' && item.sourceTitle.trim().length > 0
    && typeof item.externalSku === 'string' && item.externalSku.trim().length > 0
    && Number.isInteger(item.shopSaleCents) && Number(item.shopSaleCents) >= 0;
}

export function validCollectedSourceProduct(value: unknown): value is CollectedSourceProductInput {
  if (!validSourceProduct(value)) return false;
  const item = value as Record<string, unknown>;
  return item.collectionStatus === 'enriched' || item.collectionStatus === 'needs_authorization' || item.collectionStatus === 'failed';
}

export async function importSourceProducts(db: D1Database, products: SourceProductInput[]) {
  await ensureCatalogSchema(db);
  const latest = new Map<string, SourceProductInput>();
  for (const product of products) {
    const sourceProductId = sourceProductIdFromUrl(product.sourceUrl);
    if (sourceProductId) latest.set(sourceProductId, product);
  }
  const now = Date.now();
  const rows = [...latest.values()];
  await db.batch(rows.flatMap((product) => {
    const sourceProductId = sourceProductIdFromUrl(product.sourceUrl);
    return [
      db.prepare(
        `INSERT INTO source_products (id, shop_id, source_url, source_product_id, source_title, shop_sale_cents, external_sku, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
         ON CONFLICT(shop_id, source_product_id) DO UPDATE SET
           source_url = excluded.source_url, source_title = excluded.source_title, shop_sale_cents = excluded.shop_sale_cents,
           external_sku = excluded.external_sku, updated_at = excluded.updated_at`,
      ).bind(crypto.randomUUID(), shopId, product.sourceUrl, sourceProductId, product.sourceTitle, product.shopSaleCents, product.externalSku, now, now),
      db.prepare(
        `INSERT INTO knowledge_entries (id, shop_id, source_product_id, title, status, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?)
         ON CONFLICT(shop_id, source_product_id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`,
      ).bind(crypto.randomUUID(), shopId, sourceProductId, product.sourceTitle, now),
    ];
  }));
  return rows.length;
}

export async function listSourceProducts(db: D1Database) {
  await ensureCatalogSchema(db);
  const [result, productResult] = await Promise.all([
    db.prepare(
    `SELECT source_products.*, knowledge_entries.status AS knowledge_status, knowledge_entries.material,
       knowledge_entries.specifications, knowledge_entries.attributes_json, knowledge_entries.selling_points, knowledge_entries.image_url,
       knowledge_entries.source_price_cents, product_source_links.product_id AS linked_product_id,
       products.name AS linked_product_name, products.sku AS linked_product_sku
     FROM source_products LEFT JOIN knowledge_entries
       ON knowledge_entries.shop_id = source_products.shop_id
       AND knowledge_entries.source_product_id = source_products.source_product_id
     LEFT JOIN product_source_links
       ON product_source_links.shop_id = source_products.shop_id
       AND product_source_links.source_product_id = source_products.source_product_id
     LEFT JOIN products ON products.id = product_source_links.product_id AND products.shop_id = source_products.shop_id
     WHERE source_products.shop_id = ?
     ORDER BY source_products.updated_at DESC LIMIT 500`,
    ).bind(shopId).all<Record<string, unknown>>(),
    db.prepare('SELECT * FROM products WHERE shop_id = ? ORDER BY updated_at DESC').bind(shopId).all<Record<string, unknown>>(),
  ]);
  const products = productResult.results.map(mapProduct);
  return result.results.map((row) => mapSourceProduct(row, products));
}

function knowledgeMatchScore(question: string, item: ConfirmedProductKnowledge) {
  const normalizedQuestion = normalizedText(question);
  if (!normalizedQuestion) return 0;
  const productName = normalizedText(item.productName);
  const sku = normalizedText(item.sku);
  const sourceTitle = normalizedText(item.sourceTitle);
  let score = 0;
  if (productName.length >= 2 && (normalizedQuestion.includes(productName) || productName.includes(normalizedQuestion))) score += 70;
  if (sku && normalizedQuestion.includes(sku)) score += 70;
  if (item.color && question.includes(item.color)) score += 25;
  if (item.size && new RegExp(`${item.size}\\s*码`).test(question)) score += 20;
  if (item.material && question.includes(item.material)) score += 20;
  if (sourceTitle.length >= 4 && (normalizedQuestion.includes(sourceTitle) || sourceTitle.includes(normalizedQuestion))) score += 40;
  return score;
}

async function listConfirmedSourceKnowledge(db: D1Database) {
  await ensureCatalogSchema(db);
  const result = await db.prepare(
    `SELECT product_source_links.product_id, products.name AS product_name, products.sku,
       products.color, products.size, source_products.source_product_id, source_products.source_title,
       knowledge_entries.material, knowledge_entries.specifications, knowledge_entries.attributes_json, knowledge_entries.selling_points,
       knowledge_entries.updated_at
     FROM product_source_links
     JOIN products ON products.id = product_source_links.product_id AND products.shop_id = product_source_links.shop_id
     JOIN source_products ON source_products.source_product_id = product_source_links.source_product_id
       AND source_products.shop_id = product_source_links.shop_id
     JOIN knowledge_entries ON knowledge_entries.source_product_id = product_source_links.source_product_id
       AND knowledge_entries.shop_id = product_source_links.shop_id
     WHERE product_source_links.shop_id = ? AND knowledge_entries.status = 'confirmed'
     ORDER BY knowledge_entries.updated_at DESC LIMIT 100`,
  ).bind(shopId).all<Record<string, unknown>>();

  return result.results.filter(customerSafeSourceKnowledge).map((row) => ({
    productId: String(row.product_id), productName: String(row.product_name), sku: String(row.sku),
    color: String(row.color), size: String(row.size), sourceProductId: String(row.source_product_id),
    sourceTitle: String(row.source_title), material: String(row.material ?? ''),
    specifications: String(row.specifications ?? ''), attributes: readAttributes(row.attributes_json), sellingPoints: String(row.selling_points ?? ''),
    updatedAt: Number(row.updated_at),
  }) satisfies ConfirmedProductKnowledge);
}

async function listConfirmedStoreDetailKnowledge(db: D1Database, activeShopId = shopId) {
  await ensureCatalogSchema(db);
  const result = await db.prepare(
    `SELECT product_detail_knowledge.*, products.id AS resolved_product_id, products.name AS resolved_product_name,
       products.color AS product_color, products.size AS product_size
     FROM product_detail_knowledge
     LEFT JOIN products ON products.shop_id = product_detail_knowledge.shop_id AND products.sku = product_detail_knowledge.sku
     WHERE product_detail_knowledge.shop_id = ? AND product_detail_knowledge.status = 'confirmed'
       AND product_detail_knowledge.conflicts_json = '[]'
     ORDER BY product_detail_knowledge.updated_at DESC LIMIT 100`,
  ).bind(activeShopId).all<Record<string, unknown>>();
  return result.results.map((row) => ({
    productId: String(row.resolved_product_id ?? row.product_id ?? row.sku),
    productName: String(row.resolved_product_name ?? row.product_name), sku: String(row.sku),
    color: customerSafeColors(String(row.colors || row.product_color || '')),
    size: customerSafeSizes(String(row.sizes || row.product_size || '')),
    sourceProductId: `douyin-detail:${String(row.sku)}`, sourceTitle: String(row.product_name),
    material: String(row.material ?? ''), specifications: String(row.specifications ?? ''),
    attributes: readAttributes(row.attributes_json), sellingPoints: '', updatedAt: Number(row.updated_at),
  }) satisfies ConfirmedProductKnowledge);
}

/**
 * Customer service now treats the merchant's own store page as the sole source
 * of truth. Supply-chain records remain stored for a future operations add-on,
 * but are deliberately excluded from all customer-facing retrieval.
 */
export async function listConfirmedProductKnowledge(db: D1Database, activeShopId = shopId) {
  return listConfirmedStoreDetailKnowledge(db, activeShopId);
}

export async function findConfirmedProductKnowledge(db: D1Database, question: string, activeShopId = shopId) {
  const knowledge = await listConfirmedProductKnowledge(db, activeShopId);
  return knowledge.map((item) => ({ item, score: knowledgeMatchScore(question, item) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || right.item.updatedAt - left.item.updatedAt)
    .slice(0, 3)
    .map(({ item }) => item);
}

export async function importCollectedSourceProducts(db: D1Database, products: CollectedSourceProductInput[]) {
  await importSourceProducts(db, products);
  const now = Date.now();
  await db.batch(products.flatMap((product) => {
    const sourceProductId = sourceProductIdFromUrl(product.sourceUrl);
    const status = product.collectionStatus;
    return [
      db.prepare('UPDATE source_products SET status = ?, updated_at = ? WHERE shop_id = ? AND source_product_id = ?').bind(status, now, shopId, sourceProductId),
      db.prepare(
        `UPDATE knowledge_entries SET title = ?, material = ?, specifications = ?, attributes_json = ?, selling_points = ?, image_url = ?,
         source_price_cents = ?, status = 'pending', updated_at = ? WHERE shop_id = ? AND source_product_id = ?`,
      ).bind(
        product.title?.trim() || product.sourceTitle, product.material?.trim() || '', product.specifications?.trim() || '', JSON.stringify(normalizeAttributes(product.attributes)),
        product.sellingPoints?.trim() || '', product.imageUrl?.trim() || '', product.sourcePriceCents ?? null,
        now, shopId, sourceProductId,
      ),
    ];
  }));
  return products.length;
}

export async function getSourceProduct(db: D1Database, id: string) {
  await ensureCatalogSchema(db);
  const row = await db.prepare(
    'SELECT * FROM source_products WHERE id = ? AND shop_id = ?',
  ).bind(id, shopId).first<Record<string, unknown>>();
  return row ? { id: String(row.id), sourceUrl: String(row.source_url), sourceProductId: String(row.source_product_id), sourceTitle: String(row.source_title) } : null;
}

export async function saveCollectedSourceFacts(db: D1Database, id: string, facts: CollectedSourceFacts) {
  await ensureCatalogSchema(db);
  const source = await getSourceProduct(db, id);
  if (!source) return null;
  const now = Date.now();
  await db.batch([
    db.prepare('UPDATE source_products SET status = ?, updated_at = ? WHERE id = ? AND shop_id = ?').bind(facts.status, now, id, shopId),
    db.prepare(
      `UPDATE knowledge_entries SET title = ?, material = ?, specifications = ?, attributes_json = ?, selling_points = ?, image_url = ?,
       source_price_cents = ?, status = 'pending', updated_at = ? WHERE shop_id = ? AND source_product_id = ?`,
    ).bind(
      facts.title?.trim() || source.sourceTitle, facts.material?.trim() || '', facts.specifications?.trim() || '', JSON.stringify(normalizeAttributes(facts.attributes)),
      facts.sellingPoints?.trim() || '', facts.imageUrl?.trim() || '', facts.sourcePriceCents ?? null,
      now, shopId, source.sourceProductId,
    ),
  ]);
  return { ...source, ...facts, updatedAt: now };
}

export async function confirmSourceKnowledge(db: D1Database, id: string) {
  await ensureCatalogSchema(db);
  const source = await getSourceProduct(db, id);
  if (!source) return null;

  const collected = await db.prepare(
    `SELECT material, specifications, attributes_json, selling_points, image_url, source_price_cents
     FROM knowledge_entries
     WHERE shop_id = ? AND source_product_id = ?`,
  ).bind(shopId, source.sourceProductId).first<Record<string, unknown>>();

  if (!collected || (!String(collected.material ?? '').trim() && !String(collected.specifications ?? '').trim() && !Object.keys(readAttributes(collected.attributes_json)).length && !String(collected.selling_points ?? '').trim())) {
    return { state: 'not_collected' as const };
  }

  const now = Date.now();
  await db.prepare(
    `UPDATE knowledge_entries
     SET status = 'confirmed', updated_at = ?
     WHERE shop_id = ? AND source_product_id = ?`,
  ).bind(now, shopId, source.sourceProductId).run();
  return { state: 'confirmed' as const, updatedAt: now };
}

export async function linkSourceProduct(db: D1Database, sourceId: string, productId: string) {
  await ensureCatalogSchema(db);
  const source = await getSourceProduct(db, sourceId);
  if (!source) return null;
  const product = await db.prepare('SELECT id, name, sku FROM products WHERE id = ? AND shop_id = ?').bind(productId, shopId).first<Record<string, unknown>>();
  if (!product) return { state: 'product_not_found' as const };
  const now = Date.now();
  await db.prepare(
    `INSERT INTO product_source_links (id, shop_id, source_product_id, product_id, confidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, 100, ?, ?)
     ON CONFLICT(shop_id, source_product_id) DO UPDATE SET product_id = excluded.product_id, confidence = 100, updated_at = excluded.updated_at`,
  ).bind(crypto.randomUUID(), shopId, source.sourceProductId, productId, now, now).run();
  return { state: 'linked' as const, product: { id: String(product.id), name: String(product.name), sku: String(product.sku) } };
}

/** Only links collected sources whose title/specification match is strong enough for a reversible association. */
export async function autoLinkRecommendedSources(db: D1Database, minimumConfidence = 75) {
  const sources = await listSourceProducts(db);
  const candidates = sources.filter((source) => (
    source.status === 'enriched'
    && !source.linkedProductId
    && source.recommendedProductId
    && (source.matchConfidence ?? 0) >= minimumConfidence
  ));
  let linked = 0;
  let failed = 0;
  for (const source of candidates) {
    try {
      const result = await linkSourceProduct(db, source.id, source.recommendedProductId!);
      if (result?.state === 'linked') linked += 1;
      else failed += 1;
    } catch { failed += 1; }
  }
  return { scanned: sources.length, eligible: candidates.length, linked, failed, minimumConfidence };
}

export async function unlinkSourceProduct(db: D1Database, sourceId: string) {
  await ensureCatalogSchema(db);
  const source = await getSourceProduct(db, sourceId);
  if (!source) return null;
  const result = await db.prepare(
    'DELETE FROM product_source_links WHERE shop_id = ? AND source_product_id = ?',
  ).bind(shopId, source.sourceProductId).run();
  return result.meta.changes > 0;
}

export type HandoffTicket = { id: string; customerName: string; reason: string; createdAt: number };
export type ConversationDraft = { id: string; customerName: string; status: 'open' | 'needs_human'; customerText: string; draftText: string; updatedAt: number };
export type ConnectorAction = { id: string; conversationId: string; draftText: string };

export async function saveConversationTurn(db: D1Database, input: {
  conversationId?: string; customerText: string; assistantText: string; handoffReason?: string; shopId?: string;
}) {
  await ensureCatalogSchema(db);
  const now = Date.now();
  const conversationId = input.conversationId || crypto.randomUUID();
  const activeShopId = input.shopId || shopId;
  const existing = await db.prepare('SELECT id FROM conversations WHERE id = ? AND shop_id = ?').bind(conversationId, activeShopId).first();
  const queries = [
    existing
      ? db.prepare('UPDATE conversations SET last_message = ?, updated_at = ?, status = ? WHERE id = ? AND shop_id = ?').bind(input.customerText, now, input.handoffReason ? 'needs_human' : 'open', conversationId, activeShopId)
      : db.prepare('INSERT INTO conversations (id, shop_id, customer_name, status, last_message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(conversationId, activeShopId, '体验客户', input.handoffReason ? 'needs_human' : 'open', input.customerText, now, now),
    db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), conversationId, 'customer', input.customerText, now),
    db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), conversationId, 'assistant', input.assistantText, now),
  ];
  if (input.handoffReason) queries.push(db.prepare('INSERT INTO handoff_tickets (id, conversation_id, reason, status, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), conversationId, input.handoffReason, 'open', now));
  await db.batch(queries);
  return conversationId;
}

export async function listOpenHandoffTickets(db: D1Database, activeShopId = shopId) {
  await ensureCatalogSchema(db);
  const result = await db.prepare(
    `SELECT handoff_tickets.id, conversations.customer_name, handoff_tickets.reason, handoff_tickets.created_at
     FROM handoff_tickets JOIN conversations ON conversations.id = handoff_tickets.conversation_id
     WHERE handoff_tickets.status = 'open' AND conversations.shop_id = ?
     ORDER BY handoff_tickets.created_at DESC LIMIT 20`,
  ).bind(activeShopId).all<Record<string, unknown>>();
  return result.results.map((row) => ({ id: String(row.id), customerName: String(row.customer_name), reason: String(row.reason), createdAt: Number(row.created_at) })) satisfies HandoffTicket[];
}

export async function listConversationDrafts(db: D1Database, activeShopId = shopId) {
  await ensureCatalogSchema(db);
  const result = await db.prepare(
    `SELECT conversations.id, conversations.customer_name, conversations.status, conversations.last_message, conversations.updated_at,
      (SELECT content FROM messages WHERE conversation_id = conversations.id AND role = 'assistant' ORDER BY created_at DESC LIMIT 1) AS draft_text
     FROM conversations
     WHERE conversations.shop_id = ?
     ORDER BY conversations.updated_at DESC LIMIT 30`,
  ).bind(activeShopId).all<Record<string, unknown>>();
  return result.results.map((row) => ({
    id: String(row.id), customerName: String(row.customer_name || '客户'),
    status: row.status === 'needs_human' ? 'needs_human' : 'open',
    customerText: String(row.last_message || ''), draftText: String(row.draft_text || ''), updatedAt: Number(row.updated_at),
  })) satisfies ConversationDraft[];
}

export async function getConversationDraft(db: D1Database, conversationId: string, activeShopId = shopId) {
  return (await listConversationDrafts(db, activeShopId)).find((item) => item.id === conversationId) || null;
}

export async function queueDraftFillAction(db: D1Database, conversationId: string, draftText: string, activeShopId = shopId) {
  await ensureCatalogSchema(db);
  const now = Date.now();
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO connector_actions (id, shop_id, conversation_id, type, draft_text, status, created_at)
     VALUES (?, ?, ?, 'fill_draft', ?, 'pending', ?)`,
  ).bind(id, activeShopId, conversationId, draftText, now).run();
  return { id };
}

export async function nextPendingDraftFillAction(db: D1Database, activeShopId = shopId) {
  await ensureCatalogSchema(db);
  const row = await db.prepare(
    `SELECT id, conversation_id, draft_text FROM connector_actions
     WHERE shop_id = ? AND type = 'fill_draft' AND status = 'pending'
     ORDER BY created_at ASC LIMIT 1`,
  ).bind(activeShopId).first<Record<string, unknown>>();
  return row ? { id: String(row.id), conversationId: String(row.conversation_id), draftText: String(row.draft_text) } satisfies ConnectorAction : null;
}

export async function finishDraftFillAction(db: D1Database, actionId: string, status: 'filled' | 'failed', errorText = '', activeShopId = shopId) {
  await ensureCatalogSchema(db);
  const result = await db.prepare(
    `UPDATE connector_actions SET status = ?, completed_at = ?, error_text = ?
     WHERE id = ? AND shop_id = ? AND status = 'pending'`,
  ).bind(status, Date.now(), errorText.slice(0, 300), actionId, activeShopId).run();
  return result.meta.changes > 0;
}
