"use strict";
const axios = require("axios");
const avro = require("avsc");
const fs = require("fs/promises");
const Websocket = require("ws")


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
     * The authorization is either direct or a refresh token
     *
     * @returns {Promise<Auth.refresh>} Value is not used.
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


function Sender() {
    this.gatewayUrl = "http://gateway-internal.core.svc/event";
    this.schemaId = "clickstream";
    let authUrl = "https" + "://" + "auth.dev.strm.services"
    let credentialsFile = "credentials.json";

    this.init = function(){
        return new Promise((resolve,reject) => {
            fs.readFile(credentialsFile).then(data => {
                let credentials = JSON.parse(data);
                this.auth = new Auth(authUrl, credentials.IN.billingId, credentials.IN.clientId, credentials.IN.secret);
                this.auth.authenticate().then( _ => {
                    fs.readFile(`schema-cache/${this.schemaId}.avsc`).then(data => {
                        this.type = avro.Type.forSchema(JSON.parse(data));
                        resolve(this);
                    });
                }).catch(error => reject(error))
            });
        })
    }
    this.send_event = function(event) {
        event.strmMeta.schemaId=this.schemaId;
        event.strmMeta.nonce=0
        event.strmMeta.timestamp=0
        const request_config = {
            method: "post",
            url: this.gatewayUrl,
            headers: {
                "Authorization": "Bearer " + this.auth.getBearerHeaderValue(),
                "Content-Type": "application/octet-stream",
                "Strm-Serialization-Type": "application/x-avro-binary",
                "Strm-Schema-Id": this.schemaId
            },
            data: this.type.toBuffer(event)
        };
        axios(request_config).then(res => {
            console.log(request_config.url, res.status);
        }).catch(error => {
            console.error(error);
        })

    }
}

function WsReceiver(callback) {
    this.egressUrl = "ws://egress-internal.core.svc";
    this.schemaUrl = "http://egress-internal.core.svc";
    this.schemaId = "clickstream";
    let authUrl = "https" + "://" + "auth.dev.strm.services"
    let credentialsFile = "credentials.json";
    this.schemaCache = {}
    this.callback = callback;

    this.init = function(streamnr){
        return new Promise((resolve,reject) => {
            fs.readFile(credentialsFile).then(data => {
                let credentials = JSON.parse(data);
                let billingId = credentials.IN.billingId;
                if (streamnr === undefined) {
                    credentials = credentials.IN;
                }
                else {
                    credentials = credentials.OUT[streamnr];
                }
                this.auth = new Auth(authUrl, billingId, credentials.clientId, credentials.secret);
                this.auth.authenticate().then( _ => {
                    resolve(this);
                }).catch(error => reject(error))
            });
        })
    }
    this.connect_ws = function() {
        this.ws = new Websocket(`${this.egressUrl}/ws`, {
            headers: {
                Authorization: "Bearer "+ this.auth.getBearerHeaderValue()
            }
        })
        this.ws.on('open', () => {
            console.debug("websocket connected");
        })
        this.ws.on('close', () => {
            console.debug("websocket disconnected");
            delete this.ws;
        })
        this.ws.on('message', (message) => {

            // the base64 is a consequence from the fact that our current Egress websocket implementation
            // cannot send binary packets. As a quick-and-dirty workaround, I've put in a base64 encoding.
            // TODO send bloody binaries.
            let buf = Buffer.from(message, 'base64')
            // these two lines are only valid for a Confluent type message wrapper.
            let schemaId = buf.readUInt32BE(1);
            let avroPayload = buf.slice(5)

            this.getSchemaById(schemaId).then(schema => {
                    let decoded = schema.fromBuffer(avroPayload);
                    this.callback(decoded);
                })

        })
    }

    /**
     * return a Promise to avsc interpreted schema definition.
     * @param schemaId
     */
    this.getSchemaById = function(schemaId) {
        let schema = this.schemaCache[schemaId];
        if(schema === undefined) {
            this.schemaCache[schemaId] = new Promise((resolve,reject) => {
                // retrieve the schema from the Confluent schema registry (proxied by the egress).
                axios.get(`${this.schemaUrl}/schemas/ids/${schemaId}`, {
                    headers: { "Authorization": this.auth.getBearerHeaderValue() }
                }).then(result => {
                    let type = avro.Type.forSchema(JSON.parse(result.data.schema));
                    console.log(`Retrieved schema for ${schemaId}`)
                    resolve(type);
                })
            })
        }
        return this.schemaCache[schemaId];
    }
}

module.exports = {Sender, WsReceiver}