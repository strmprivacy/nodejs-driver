import { Type } from "avsc";
import * as fs from "fs";
import { Sender } from "./sender";
import { ClientStreamEvent } from "./models/event";

const CONFIG = require("../assets/config.json");

// Copy the template credentials file, name it `credentials.json` and fill out the values
const CREDENTIALS = require("../assets/credentials.json");

// Hard coded schema for this example
const SCHEMA = JSON.parse(fs.readFileSync("assets/clickstream.avsc", "utf-8"));

async function startSender() {
  // Note: the schema id is hard coded in this example, in the config.json. This will be dynamically determined in a future version
  const sender = new Sender({
    ...CONFIG,
    ...CREDENTIALS,
    type: Type.forSchema(SCHEMA),
  });

  // Make sure to listen for error events, otherwise Node does not handle the error events (they're escalated)
  sender.on("error", (error) => {
    console.log("Sender", error);
  });

  await sender.connect().catch((e) => {
    console.error(`Connect error ${e}`);
  });

  setInterval(async function () {
    try {
      const r = await sender.send(EVENT);

      if (r.status !== 204) {
        console.debug(`An error occurred while sending event:`, r);
      }
    } catch (e) {
      console.error(`Error: ${e}`);
    }
  }, 1000);
}

// This interface is only required, if a schema is used like this (through a file). A future example will also contain generated classes from the schema, which simplifies this example even more.
interface MyStreamEvent extends ClientStreamEvent {
  abTests: string[];
  eventType: string;
  customer: { id: string };
  referrer: string;
  userAgent: string;
  producerSessionId: string;
  conversion: number;
  url: string;
}

const EVENT: MyStreamEvent = {
  abTests: ["abc"],
  eventType: "button x clicked",
  customer: { id: "customer-id" },
  referrer: "https://www.streammachine.io",
  userAgent: "node-js",
  producerSessionId: "prodsesid",
  conversion: 1,
  url: "https://portal.streammachine.io/",
  strmMeta: {
    // the other fields are filled in by the Stream Machine Client
    consentLevels: [0, 1, 2],
  },
};

async function sleep(millis: number) {
  return new Promise((resolve) => setTimeout(resolve, millis));
}

startSender();
