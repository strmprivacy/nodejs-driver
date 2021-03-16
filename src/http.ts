import { ClientHttp2Session, connect, constants } from "http2";
import { OutgoingHttpHeaders } from "http";

interface Http2Response<T> {
  status: number;
  data?: T;
}

export function post<R = undefined>(
  urlOrClient: string | ClientHttp2Session,
  path: string,
  dataStringOrBuffer: string | Buffer,
  headers: OutgoingHttpHeaders = {}
): Promise<Http2Response<R>> {
  return new Promise<Http2Response<R>>((resolve, reject) => {
    const client: ClientHttp2Session =
      typeof urlOrClient === "string" ? connect(urlOrClient) : urlOrClient;

    const buffer =
      typeof dataStringOrBuffer === "string" ? Buffer.from(dataStringOrBuffer) : dataStringOrBuffer;

    const request = client.request({
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

    request.write(buffer);

    const isLocalClientSession = typeof urlOrClient === "string";
    request.on("end", () => {
      const body = chunks.join();
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

      if (isLocalClientSession) {
        client.close();
      }
    });

    request.end();
  });
}
