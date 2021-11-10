/**
 * STRM Privacy event type.
 */
export interface StrmPrivacyEvent {
  strmSchemaType: string;
  strmSchemaRef: string;
  schema(): object;

  strmMeta: StrmPrivacyEventMetadata;

  [key: string]: any;
}

/**
 * STRM Privacy event metadata type.
 */
export interface StrmPrivacyEventMetadata {
  eventContractRef: string;
  consentLevels: number[];
}
