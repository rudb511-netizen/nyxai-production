import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalogProduct, catalogProducts, skuForPlatform } from "./purchase-service.ts";

describe("purchase catalog", () => {
  it("maps Apple and Google SKUs separately", () => {
    const monthly = catalogProduct("nyx.ai.monthly");
    assert.ok(monthly);
    assert.equal(monthly!.type, "subscription");
    assert.equal(skuForPlatform(monthly!, "ios"), "com.nyx.ai.monthly");
    assert.equal(skuForPlatform(monthly!, "android"), "nyx_ai_monthly");
    assert.equal(monthly!.androidPlanId, "monthly");
  });

  it("treats coin packs as consumables", () => {
    const pack = catalogProduct("nyx.coin.100");
    assert.ok(pack);
    assert.equal(pack!.type, "consumable");
    assert.equal(pack!.family, "coins");
  });

  it("looks up by either store sku", () => {
    assert.equal(catalogProduct("com.nyx.verify.yearly")?.id, "nyx.verify.yearly");
    assert.equal(catalogProduct("nyx_verify_yearly")?.id, "nyx.verify.yearly");
  });

  it("has no duplicate catalog ids", () => {
    const ids = catalogProducts().map((p) => p.id);
    assert.equal(ids.length, new Set(ids).size);
  });
});
