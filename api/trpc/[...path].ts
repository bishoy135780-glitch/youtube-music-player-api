import type { IncomingMessage, ServerResponse } from "node:http";

const YOUTUBE_SEARCH_URL = "https://www.youtube.com/results?search_query=";
const YOUTUBE_CLIENT_VERSION = "2.20241010.01.00";
const YOUTUBE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
  "Accept-Language": "ar,en-US;q=0.9,en;q=0.8",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

type VideoResult = {
  id: string;
  title: string;
  channel: string;
  duration: string;
  views: string;
  published: string;
  thumbnail: string;
  url: string;
};

function textFrom(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const item = value as { simpleText?: string; runs?: Array<{ text?: string }> };
  if (typeof item.simpleText === "string") return item.simpleText;
  return Array.isArray(item.runs)
    ? item.runs.map((run) => run.text ?? "").join("")
    : "";
}

function getInitialData(html: string): Record<string, unknown> {
  const markers = ["var ytInitialData = ", "ytInitialData = "];
  const marker = markers.find((item) => html.includes(item));
  if (!marker) throw new Error("لم نعثر على بيانات نتائج يوتيوب في الصفحة");
  const start = html.indexOf(marker) + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        const parsed: unknown = JSON.parse(html.slice(start, index + 1));
        if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
        break;
      }
    }
  }
  throw new Error("صيغة بيانات يوتيوب غير متوقعة");
}

function findVideoRenderers(
  value: unknown,
  output: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    value.forEach((item) => findVideoRenderers(item, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;

  const object = value as Record<string, unknown>;
  if (object.videoRenderer && typeof object.videoRenderer === "object") {
    output.push(object.videoRenderer as Record<string, unknown>);
  }
  Object.values(object).forEach((item) => findVideoRenderers(item, output));
  return output;
}

async function searchYouTube(query: string, limit: number): Promise<VideoResult[]> {
  const response = await fetch(`${YOUTUBE_SEARCH_URL}${encodeURIComponent(query)}`, {
    headers: YOUTUBE_HEADERS,
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) throw new Error(`YouTube returned ${response.status}`);
  const data = getInitialData(await response.text());
  const results: VideoResult[] = [];
  const seen = new Set<string>();

  for (const item of findVideoRenderers(data)) {
    const id = typeof item.videoId === "string" ? item.videoId : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const thumbnails = (
      item.thumbnail as
        | { thumbnails?: Array<{ url?: string }> }
        | undefined
    )?.thumbnails;
    results.push({
      id,
      title: textFrom(item.title) || "بدون عنوان",
      channel: textFrom(item.ownerText) || "قناة غير معروفة",
      duration: textFrom(item.lengthText) || "غير معروف",
      views: textFrom(item.viewCountText) || "مشاهدات غير معروفة",
      published: textFrom(item.publishedTimeText) || "حديثًا",
      thumbnail:
        thumbnails?.at(-1)?.url ??
        `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${id}`,
    });
    if (results.length >= limit) break;
  }

  return results;
}

function extractPlaylistVideoRenderers(
  value: unknown,
  output: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    value.forEach((item) => extractPlaylistVideoRenderers(item, output));
    return output;
  }
  if (!value || typeof value !== "object") return output;
  const object = value as Record<string, unknown>;
  if (
    object.playlistVideoRenderer &&
    typeof object.playlistVideoRenderer === "object"
  ) {
    output.push(object.playlistVideoRenderer as Record<string, unknown>);
  }
  Object.values(object).forEach((item) =>
    extractPlaylistVideoRenderers(item, output),
  );
  return output;
}

async function importYouTubePlaylist(playlistId: string): Promise<VideoResult[]> {
  const response = await fetch(
    "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false",
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: "https://www.youtube.com",
        Referer: "https://www.youtube.com/",
        "User-Agent": "Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB",
            clientVersion: YOUTUBE_CLIENT_VERSION,
            hl: "ar",
            gl: "EG",
          },
        },
        browseId: `VL${playlistId}`,
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) throw new Error(`YouTube returned ${response.status}`);
  const data = (await response.json()) as unknown;
  const results: VideoResult[] = [];
  const seen = new Set<string>();
  for (const item of extractPlaylistVideoRenderers(data)) {
    const id = typeof item.videoId === "string" ? item.videoId : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const thumbnails = (
      item.thumbnail as { thumbnails?: Array<{ url?: string }> } | undefined
    )?.thumbnails;
    results.push({
      id,
      title: textFrom(item.title) || "بدون عنوان",
      channel: textFrom(item.shortBylineText) || "قناة غير معروفة",
      duration: textFrom(item.lengthText) || "غير معروف",
      views: "",
      published: "",
      thumbnail:
        thumbnails?.at(-1)?.url ??
        `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${id}`,
    });
    if (results.length >= 100) break;
  }
  return results;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.end(JSON.stringify(body));
}

function trpcSuccess(data: unknown) {
  return { result: { data: { json: data } } };
}

function trpcError(path: string, message: string) {
  return {
    error: {
      json: {
        message,
        code: -32603,
        data: {
          code: "INTERNAL_SERVER_ERROR",
          httpStatus: 500,
          path,
        },
      },
    },
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function extractInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const object = value as Record<string, unknown>;
  const first = object["0"];
  if (first && typeof first === "object") {
    const nested = (first as Record<string, unknown>).json;
    return nested && typeof nested === "object"
      ? (nested as Record<string, unknown>)
      : {};
  }
  const json = object.json;
  return json && typeof json === "object"
    ? (json as Record<string, unknown>)
    : object;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const requestUrl = new URL(req.url ?? "/", "https://vercel.local");
  const path =
    requestUrl.pathname.split("/api/trpc/")[1] ??
    requestUrl.searchParams.get("path") ??
    "";

  try {
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
      res.end();
      return;
    }
    if (path === "system.health") {
      sendJson(res, 200, trpcSuccess({ ok: true }));
      return;
    }

    if (path === "youtube.playlist") {
      let rawInput: unknown = requestUrl.searchParams.get("input")
        ? JSON.parse(requestUrl.searchParams.get("input") as string)
        : {};
      if (req.method === "POST") {
        const body = await readBody(req);
        if (body) rawInput = JSON.parse(body);
      }
      const input = extractInput(rawInput);
      const playlistId =
        typeof input.playlistId === "string" ? input.playlistId.trim() : "";
      if (!playlistId) {
        sendJson(res, 400, trpcError(path, "Playlist ID is required"));
        return;
      }
      sendJson(res, 200, trpcSuccess(await importYouTubePlaylist(playlistId)));
      return;
    }

    if (path !== "youtube.search") {
      sendJson(res, 404, trpcError(path, "Unknown API procedure"));
      return;
    }

    let rawInput: unknown = requestUrl.searchParams.get("input")
      ? JSON.parse(requestUrl.searchParams.get("input") as string)
      : {};
    if (req.method === "POST") {
      const body = await readBody(req);
      if (body) rawInput = JSON.parse(body);
    }

    const input = extractInput(rawInput);
    const query = typeof input.query === "string" ? input.query.trim() : "";
    const limit =
      typeof input.limit === "number"
        ? Math.min(Math.max(Math.trunc(input.limit), 1), 20)
        : 8;
    if (!query) {
      sendJson(res, 400, trpcError(path, "Search query is required"));
      return;
    }

    const results = await searchYouTube(query, limit);
    sendJson(res, 200, trpcSuccess(results));
  } catch (error) {
    console.error("[Vercel API] Request failed", error);
    sendJson(
      res,
      500,
      trpcError(path, error instanceof Error ? error.message : "Request failed"),
    );
  }
}
