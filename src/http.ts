import { ClientHttp2Session, connect, constants } from "http2";
import { OutgoingHttpHeaders } from "http";

export interface Http2Response<T> {
  status: number;
  data?: T;
}

/**
 * Http2 post implementation
 * @param urlOrSession Url opens/closes a new session | Session is maintained externally.
 * @param path Endpoint path.
 * @param dataStringOrBuffer Data string is converted to a buffer | Buffer is used as-is.
 * @param headers Request headers
 */
export function post<R = undefined>(
  urlOrSession: string | ClientHttp2Session,
  path: string,
  dataStringOrBuffer: string | Buffer,
  headers: OutgoingHttpHeaders = {}
): Promise<Http2Response<R>> {
  return new Promise<Http2Response<R>>((resolve, reject) => {
    console.debug("Posting to ", urlOrSession, path);
    const session: ClientHttp2Session =
      typeof urlOrSession === "string" ? connect(urlOrSession) : urlOrSession;

    const buffer: Buffer =
      typeof dataStringOrBuffer === "string" ? Buffer.from(dataStringOrBuffer) : dataStringOrBuffer;

    const request = session.request({
      [constants.HTTP2_HEADER_SCHEME]: "https",
      [constants.HTTP2_HEADER_METHOD]: constants.HTTP2_METHOD_POST,
      [constants.HTTP2_HEADER_PATH]: path,
      [constants.HTTP2_HEADER_CONTENT_LENGTH]: Buffer.byteLength(buffer),
      ...headers,
    });
    request.setEncoding("utf8");

    const chunks: string[] = [];
    request.on("data", (chunk) => chunks.push(chunk));

    let status: number;
    let contentType: string;

    request.on("response", (headers, flags) => {
      status = parseInt(headers[constants.HTTP2_HEADER_STATUS] as string, 10);
      contentType = headers[constants.HTTP2_HEADER_CONTENT_TYPE] as string;
    });

    request.on("end", () => {
      const body = chunks.join("");
      console.debug("received ", body.length, "bytes");
      if (status === 200) {
        const data = contentType.includes("text/plain")
          ? body
          : contentType.includes("application/json")
          ? JSON.parse(body)
          : undefined;
        resolve({ status, data });
      } else if (status === 204) {
        resolve({ status });
      } else {
        reject({ status, data: body });
      }
      /**
       * Only close session if it was created within this method.
       */
      if (typeof urlOrSession === "string") {
        session.close();
      }
    });

    request.on("error", reject);
    request.on("aborted", reject);
    request.write(buffer);
    request.end();
  });
}