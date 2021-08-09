/**
 * Stream event type.
 */
export interface StrmEvent {
  strmSchemaType: string;
  strmSchemaRef: string;
  schema(): object;

  strmMeta: StrmEventMetadata;

  [key: string]: any;
}

/**
 * Stream event metadata type.
 */
export interface StrmEventMetadata {
  eventContractRef: string;
  consentLevels: number[];
}
