/** Cosine similarity for equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function meanVector(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const out = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) out[i] += v[i];
  }
  for (let i = 0; i < dim; i++) out[i] /= vectors.length;
  return out;
}

export function normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  if (n === 0) return v.slice();
  return v.map((x) => x / n);
}

/** Simple k-means for proposing folders on messy vaults. */
export function kMeans(
  points: number[][],
  k: number,
  maxIter = 20
): { centroids: number[][]; assignments: number[] } {
  const n = points.length;
  if (n === 0 || k <= 0) return { centroids: [], assignments: [] };
  const kk = Math.min(k, n);
  const centroids = points.slice(0, kk).map((p) => p.slice());
  const assignments = new Array(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestSim = -Infinity;
      for (let c = 0; c < kk; c++) {
        const sim = cosineSimilarity(points[i], centroids[c]);
        if (sim > bestSim) {
          bestSim = sim;
          best = c;
        }
      }
      assignments[i] = best;
    }
    const buckets: number[][][] = Array.from({ length: kk }, () => []);
    for (let i = 0; i < n; i++) buckets[assignments[i]].push(points[i]);
    for (let c = 0; c < kk; c++) {
      if (buckets[c].length > 0) centroids[c] = normalize(meanVector(buckets[c]));
    }
  }
  return { centroids, assignments };
}
