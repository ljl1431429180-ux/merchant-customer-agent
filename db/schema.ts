import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    shopId: text('shop_id').notNull(),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    color: text('color').notNull(),
    size: text('size').notNull(),
    material: text('material').notNull(),
    priceCents: integer('price_cents').notNull(),
    stock: integer('stock').notNull().default(0),
    status: text('status').notNull().default('active'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('idx_products_shop_sku').on(table.shopId, table.sku),
    index('idx_products_shop_status').on(table.shopId, table.status),
  ],
);

export const syncRuns = sqliteTable(
  'sync_runs',
  {
    id: text('id').primaryKey(),
    shopId: text('shop_id').notNull(),
    platform: text('platform').notNull(),
    scope: text('scope').notNull(),
    sourceTotal: integer('source_total').notNull().default(0),
    processed: integer('processed').notNull().default(0),
    status: text('status').notNull().default('completed'),
    detail: text('detail').notNull().default(''),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('idx_sync_runs_shop_created').on(table.shopId, table.createdAt)],
);

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    shopId: text('shop_id').notNull(),
    customerName: text('customer_name').notNull(),
    status: text('status').notNull().default('open'),
    lastMessage: text('last_message').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('idx_conversations_shop_updated').on(table.shopId, table.updatedAt)],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('idx_messages_conversation_created').on(table.conversationId, table.createdAt)],
);

export const handoffTickets = sqliteTable(
  'handoff_tickets',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('open'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('idx_handoff_tickets_status_created').on(table.status, table.createdAt)],
);

export const sourceProducts = sqliteTable(
  'source_products',
  {
    id: text('id').primaryKey(),
    shopId: text('shop_id').notNull(),
    sourceUrl: text('source_url').notNull(),
    sourceProductId: text('source_product_id').notNull(),
    sourceTitle: text('source_title').notNull(),
    shopSaleCents: integer('shop_sale_cents').notNull(),
    externalSku: text('external_sku').notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('idx_source_products_shop_source_id').on(table.shopId, table.sourceProductId),
    index('idx_source_products_shop_updated').on(table.shopId, table.updatedAt),
  ],
);

export const knowledgeEntries = sqliteTable(
  'knowledge_entries',
  {
    id: text('id').primaryKey(),
    shopId: text('shop_id').notNull(),
    sourceProductId: text('source_product_id').notNull(),
    title: text('title').notNull(),
    material: text('material').notNull().default(''),
    specifications: text('specifications').notNull().default(''),
    sellingPoints: text('selling_points').notNull().default(''),
    imageUrl: text('image_url').notNull().default(''),
    sourcePriceCents: integer('source_price_cents'),
    status: text('status').notNull().default('pending'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    uniqueIndex('idx_knowledge_entries_shop_source_id').on(table.shopId, table.sourceProductId),
    index('idx_knowledge_entries_shop_status').on(table.shopId, table.status),
  ],
);
