import { Type } from "avsc";
// requires "@streammachine.io/schema-nps-unified": "3.0.0" in the dependencies of package.json
import {KioskEvent} from "@streammachine.io/schema-nps-unified/lib/io/streammachine/schemas/nps/unified/v3/KioskEvent";
import {Schema} from "avsc";
import * as assert from "assert";
import {Sender} from "./sender";

/*
credentials-dev.json is something like
{
    "billingId": "...", // via strm auth show
    "clientId": "...", // via strm streams create ...
    "secret": "..." // same
}
 */

/*
Note: the working directory for ts-node is the `src` directory. Bah.
 */
let configFile = process.argv.length > 2 ? process.argv[2] : "../credentials-dev.json"
console.info("Starting with configuration "+configFile);

const CONFIG = require(configFile);

if(CONFIG.eventCount == undefined)
  CONFIG.eventCount = 100000
if(CONFIG.eventsPerStep == undefined)
  CONFIG.eventsPerStep = 10

if(CONFIG.stsUrl == undefined)
  CONFIG.stsUrl = "https://auth.strm.services"

if(CONFIG.gatewayUrl == undefined)
  CONFIG.gatewayUrl = "https://in.strm.services"

if(CONFIG.sessionRange == undefined)
  CONFIG.sessionRange = 100;

if(CONFIG.interval == undefined)
  CONFIG.interval = 100;
if(CONFIG.sessionPrefix == undefined)
  CONFIG.sessionPrefix = "session";

CONFIG.testDuration = 5 + 0.001* (CONFIG.interval * CONFIG.eventCount)

console.info(`connecting to ${CONFIG.authUrl}, ${CONFIG.apiUrl}`);
console.info(`Sending total ${CONFIG.eventCount} events, once every ${CONFIG.interval}ms for ${CONFIG.testDuration}s.`);
console.info(JSON.stringify(CONFIG));

let sent_events=0

/* TODO this magic will go into the next version of the Stream Machine driver
 You'll only have to import the Stream Machine schema in the future
 */
// @ts-ignore
const SCHEMA_ID = KioskEvent.schema['namespace'].split(".").slice(3).join("_");
assert("nps_unified_v3" == SCHEMA_ID);
console.info(`SCHEMA_ID=${SCHEMA_ID}`);
let SERIALIZATION_TYPE = Type.forSchema(<Schema>KioskEvent.schema);

async function delay(ms: number){
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function send1(sender: Sender, event: KioskEvent) {
    if(sent_events < CONFIG.eventCount) {
        try {
            const r = await sender.send(event);

            if (r.status !== 204) {
                console.debug(`RESULT:`, r)
            }
        } catch (e) {
            console.error(`Error: ${JSON.stringify(e)}`);
        }
    }
}

async function startSender() {
    /* authUrl and apiUrl default to the Stream Machine production endpoints in
       strm.services. They only need to be set when you're connecting to
       non-production developer endpoints.

       we need three parameters for the stream descriptor: billingId, clientId and secret.
     */

    const sender = new Sender({
        ...CONFIG,
        schemaId: SCHEMA_ID,
        type: SERIALIZATION_TYPE
    });

    // Make sure to listen for error events, otherwise Node does not handle the error events (they're escalated)
    sender.on("error", (error) => {
        console.error(`sender error ${JSON.stringify(error)}`);
    });

    await sender.connect().catch(e => {
        console.error(`Connect error ${JSON.stringify(e)}`);
    });
    await delay(1000);

    let timer = setInterval(() => {
        for(var i=0;i<CONFIG.eventsPerStep; i++) {
            send1(sender, EVENT());
        }
    }, CONFIG.interval)


    while(true) {
        await delay(1000);
        if(sent_events >= CONFIG.eventCount) {
            console.info("test is done")
                break;
        }
    }
    clearInterval(timer);
    console.info("disconnecting sender");
    await sender.disconnect();
    console.info("waiting forever");
    while(true) {
        await delay(10000);
    }
}

function randomInt(i: number){
  return Math.floor(i*Math.random());
}

function randomString(s:string,i:number){
  return `${s}-${randomInt(i)}`
}

function pickRandom(strings: string[]){
  return strings[Math.floor(Math.random() * strings.length)]
}

let EVENT = () : KioskEvent => {
  let consentLevelOptions = [
      [1],
      []
  ]
  let consentLevels = consentLevelOptions[Math.floor(Math.random()*consentLevelOptions.length)];
  return {
      strmMeta: {
          consentLevels: consentLevels
      },
      event_type: pickRandom(["click", "scroll"]),
      brand_source: pickRandom(["", "Kiosk"]),
      platform: pickRandom(["app", "browser"]),
      os: pickRandom(["Mac", "Win", "Linux", "Android", "iOS"]),
      version: randomString("v_",10),
      customer_id: [randomString("customer", 100)],
      device_id: randomString("device", 100),
      session_id: randomString(CONFIG.sessionPrefix, CONFIG.sessionRange),
      context_id: randomString("context", 5),
      article_id: randomString("article", 1000),
      followable_id: randomString("followable-id", 100),
      followable_rank: randomInt(10),

      schema(): object {

          // @ts-ignore
          return undefined;
      },
      subject(): string {
          return "";
      }
  }
};

startSender();