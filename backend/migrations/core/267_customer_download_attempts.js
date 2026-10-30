// Download history is application data, included automatically in database backups.
exports.up = async function (knex) {
  if (await knex.schema.hasTable("customer_download_attempts")) return;
  await knex.schema.createTable("customer_download_attempts", (t) => {
    t.string("id", 36).primary();
    t.integer("event_id")
      .notNullable()
      .references("id")
      .inTable("events")
      .onDelete("CASCADE");
    t.integer("guest_id")
      .notNullable()
      .references("id")
      .inTable("gallery_guests")
      .onDelete("CASCADE");
    t.integer("photo_id")
      .nullable()
      .references("id")
      .inTable("photos")
      .onDelete("SET NULL");
    t.string("device_id", 80).notNullable();
    t.string("client_id", 80).notNullable();
    t.unique(
      ["event_id", "guest_id", "device_id", "client_id"],
      "customer_download_attempt_idempotency",
    );
    t.text("filename").notNullable();
    t.string("resolution", 40).nullable();
    t.string("etag", 80).notNullable();
    t.bigInteger("total_bytes").notNullable();
    t.bigInteger("received_bytes").notNullable().defaultTo(0);
    t.string("state", 24).notNullable().defaultTo("queued");
    t.timestamp("created_at").notNullable();
    t.timestamp("updated_at").notNullable();
    t.index(
      ["event_id", "guest_id", "created_at"],
      "customer_download_history_owner",
    );
  });
};
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("customer_download_attempts");
};
