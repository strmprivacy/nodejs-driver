import {Type} from "avsc";

export type SerializationType = 'AVRO_BINARY' | 'AVRO_JSON' | 'JSON';

export interface EventSerializer {
    serialize(event: any, serializationType: SerializationType): any;
}

class AvroEventSerializer implements EventSerializer {

    private schema: Type;

    constructor(schemaDefinition: any) {
        this.schema = Type.forSchema(schemaDefinition, {});
    }

    serialize(event: any, serializationType: SerializationType): any {
        if (serializationType == "AVRO_BINARY") {
            return this.schema.toBuffer(event);
        }

        if (serializationType == "AVRO_JSON") {
            throw new Error(`AVRO_JSON is not yet supported`);
        }

        throw new Error(`Invalid SerializationType for AVRO event: ${serializationType}`);
    }
}

class JsonEventSerializer implements EventSerializer {

    constructor() {
    }

    serialize(event: any, serializationType: SerializationType): any {
        if (serializationType != "JSON") {
            throw new Error(`Invalid SerializationType for JSON event: ${serializationType}`);
        }

        return event;
    }
}

export class EventSerializerProvider {

    private static providers: Map<String, EventSerializer> = new Map<String, EventSerializer>();

    public static getEventSerializer(schemaRef: String, schema: { strmSchemaType: string, schema(): any }): EventSerializer {
        let provider = this.providers.get(schemaRef);
        if (!provider) {
            provider = this.createEventSerializer(schemaRef, schema.strmSchemaType, schema.schema());

            this.providers.set(schemaRef, provider);
        }

        return provider;
    }

    private static createEventSerializer(schemaRef: String, schemaType: string, schemaDefinition: any): EventSerializer {
        switch(schemaType) {
            case "avro":
                return new AvroEventSerializer(schemaDefinition);
            case "json":
                return new JsonEventSerializer();
            default:
                throw new Error(`Invalid strmSchemaType on schema '${schemaRef}': ${schemaType}`);
        }
    }
}
