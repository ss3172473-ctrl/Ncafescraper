export interface SheetPostPayload {
  jobId: string;
  sourceUrl: string;
  cafeId: string;
  cafeName: string;
  title: string;
  authorName: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  contentText: string;
}

export interface SheetCommentPayload {
  jobId: string;
  sourceUrl: string;
  cafeId: string;
  cafeName: string;
  commentAuthor: string;
  commentBody: string;
  commentLikeCount: number;
  commentWrittenAt: string;
}

export async function sendRowsToGoogleSheet(
  postRows: SheetPostPayload[],
  commentRows: SheetCommentPayload[]
): Promise<void> {
  const endpoint = process.env.GSHEET_WEBHOOK_URL;
  if (!endpoint) {
    return;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ postRows, commentRows }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Sheet sync failed: ${response.status} ${text}`);
  }
}
