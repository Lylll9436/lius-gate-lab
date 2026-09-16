/** Public file URLs work at / locally and under the repository path on Pages. */
export function publicAsset(url: string) {
  return url.startsWith('/') && !url.startsWith('//')
    ? (process.env.NEXT_PUBLIC_BASE_PATH || '') + url
    : url;
}
