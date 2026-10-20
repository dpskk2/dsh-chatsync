// Test-only simulation of explicitly accepting previews for known isolated fixtures.
// Production sync is never bypassed; each approval uses the exact preview just returned.
export function acceptFixturePreviews(engine) {
  const original = engine.syncOnce.bind(engine);
  engine.syncOnce = async (reason, opts = {}) => {
    let result = await original(reason, opts);
    for (let round = 0; round < 20 && result.needsReview; round++) result = await original(reason, { ...opts, approval: result.review.id });
    return result;
  };
  return engine;
}
