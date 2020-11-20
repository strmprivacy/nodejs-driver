
const axios = require("axios");
const avro = require("avsc");
const fs = require("fs/promises");

let AUTH;

/**
 * object that provides a jwt that can be used for talking to streammachine.
 * @param url
 * @param billingid
 * @param clientid
 * @param secret
 * @constructor
 */
function Auth(url, billingid, clientid, secret) {
    this.baseurl=url;
    this.billingid = billingid;
    this.clientid=clientid;
    this.secret = secret;
    this.refresh = undefined

    /**
     * returns a promise with an authorization.
     *
     *
     * @returns {Promise<unknown>} Value is not used.
     */
    this.authenticate = function() {
        return new Promise((resolve, reject) => {
            let payload;
            if(this.refresh === undefined) {
                url = this.baseurl + "/auth";
                payload = {
                    "billingId": this.billingid,
                    "clientId": this.clientid,
                    "clientSecret": this.secret
                };
            }
            else {
                url = this.baseurl + "/refresh";
                payload = {
                    "refreshToken": this.refresh.refreshToken
                };
            }

            axios
                .post(url, payload)
                .then(res => {
                    console.debug(`${url}:  ${res.status}`)
                    this.refresh = res.data;
                    const EARLY = 60; // seconds before expiration time.
                    let refreshInMs = 1000*Math.floor(res.data.expiresAt - EARLY - (new Date()).getTime()/1000);
                    setTimeout(() => this.authenticate(), refreshInMs);
                    resolve(this.refresh);
                })
                .catch(error => {
                    console.error(error);
                    delete this.refresh;
                    reject(error);
                })
        })
    }
    this.getBearerHeaderValue = function(){
        return this.refresh.idToken;
    }
}

/**
 *
 * @param type
 * @param schemaId
 */
function send_event(type, schemaId) {

    let event = {
        abTests: ["abc"],
        eventType: "button x clicked",
        customer: {id: "customer-id"},
        referrer: "https://www.streammachine.io",
        userAgent: "node-js",
        producerSessionId: "prodsesid",
        conversion: 1,
        url: "https://portal.streammachine.io/",
        strmMeta: {
            timestamp: 0, // filled in at gateway.
            schemaId: schemaId,
            nonce: 0, // filled in at gateway
            consentLevels: [0, 1, 2],
        }
    }
    const buf = type.toBuffer(event);

    const request_config = {
        method: "post",
        url: "http://gateway-internal.core.svc/event",
        headers: {
            "Authorization": "Bearer " + AUTH.getBearerHeaderValue(),
            "Content-Type": "application/octet-stream",
            "Strm-Serialization-Type": "application/x-avro-binary",
            "Strm-Schema-Id": schemaId
        },
        data: buf
    };
    axios(request_config)
        .then(res => {
            console.log(request_config.url, res.status);
        })
        .catch(error => {
            console.error(error);
        })
}

async function startup() {
    let schemaId = "clickstream";
    let url = "https" + "://" + "auth.dev.strm.services"

    fs.readFile("credentials.json").then(data => {
        let creds = JSON.parse(data);
        AUTH = new Auth(url, creds.IN.billingId, creds.IN.clientId, creds.IN.secret);
        AUTH.authenticate().then( _ => {
            fs.readFile(`schema-cache/${schemaId}.avsc`).then(data => {
                let type = avro.Type.forSchema(JSON.parse(data));
                setInterval(() => send_event(type, schemaId), 500);
            });
        });



    });
    await new Promise(r => setTimeout(r, 86400000));

}

startup();

