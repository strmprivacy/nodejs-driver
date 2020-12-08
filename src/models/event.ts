/**
 * Stream event type.
 */
interface StreamEvent<MetaData> {
  strmMeta: MetaData;
}

/**
 * Stream event meta data type.
 */
interface StreamEventMetaData {
  schemaId: string;
  nonce: number;
  timestamp: number;
  consentLevels: number[];
}

/**
 * Type that represents the full event.
 */
export interface ApiStreamEvent extends StreamEvent<StreamEventMetaData> {
  [key: string]: any;
}

/**
 * Type for event creation (event without values automatically assigned by the client).
 */
export type ClientStreamEvent = StreamEvent<Pick<StreamEventMetaData, "consentLevels">>;
