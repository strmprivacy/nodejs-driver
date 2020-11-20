
const axios = require("axios");
const avro = require("avsc");
const fs = require("fs/promises");


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


function Client() {

    this.init = function(){
        this.schemaId = "clickstream";
        let url = "https" + "://" + "auth.dev.strm.services"
        return new Promise((resolve,reject) => {
            fs.readFile("credentials.json").then(data => {
                let credentials = JSON.parse(data);
                this.auth = new Auth(url, credentials.IN.billingId, credentials.IN.clientId, credentials.IN.secret);
                this.auth.authenticate().then( _ => {
                    fs.readFile(`schema-cache/${this.schemaId}.avsc`).then(data => {
                        this.type = avro.Type.forSchema(JSON.parse(data));
                        resolve(this);
                    });
                })
                .catch(error => reject(error))
            });
        })
    }
    this.send_event = function(event) {
        event.strmMeta.schemaId=this.schemaId;
        event.strmMeta.nonce=0
        event.strmMeta.timestamp=0
        const request_config = {
            method: "post",
            url: "http://gateway-internal.core.svc/event",
            headers: {
                "Authorization": "Bearer " + this.auth.getBearerHeaderValue(),
                "Content-Type": "application/octet-stream",
                "Strm-Serialization-Type": "application/x-avro-binary",
                "Strm-Schema-Id": this.schemaId
            },
            data: this.type.toBuffer(event)
        };
        axios(request_config)
            .then(res => {
                console.log(request_config.url, res.status);
            })
            .catch(error => {
                console.error(error);
            })

    }
}

/** create a dummy event.
 */
function create_event() {
    return {
        abTests: ["abc"],
        eventType: "button x clicked",
        customer: {id: "customer-id"},
        referrer: "https://www.streammachine.io",
        userAgent: "node-js",
        producerSessionId: "prodsesid",
        conversion: 1,
        url: "https://portal.streammachine.io/",
        strmMeta: {
            // the other fields are filled in by the Client
            consentLevels: [0, 1, 2],
        }
    }
}

async function startup() {
    new Client().init()
        .then(client => {
            setInterval(() => client.send_event(create_event()), 500);
        })
        .catch(error => console.error(error));
    await new Promise(r => setTimeout(r, 86400000));
}

startup();

