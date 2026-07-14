// Build a URL for a local file served by the main process `media://` protocol
// (see electron/main.ts). Use this instead of `file://` so images load in dev
// too, where the renderer origin is http:// and file:// resources are blocked.
export function mediaUrl(absolutePath: string): string {
    return `media://local/${encodeURIComponent(absolutePath)}`;
}
