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
                payload = { "refreshToken": this.refresh.refreshToken };
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
        return "Bearer " + this.refresh.idToken;
    }
}

function setupDefaults(config) {
    let defaults = {
        gatewayUrl: "https://in.strm.services/event",
        authUrl: "https://auth.strm.services",
        egressUrl: "wss://out.strm.services",
        schemaUrl: "https://out.strm.services",
        credentialsFile: "credentials.json"
    }
    Object.assign(defaults, config);
    return defaults;

}

function Sender(config, schemaId) {
    config = setupDefaults(config);
    this.gatewayUrl = config.gatewayUrl;
    this.schemaId = schemaId;

    this.init = function(){
        return new Promise((resolve,reject) => {
            fs.readFile(config.credentialsFile).then(data => {
                let credentials = JSON.parse(data);
                this.auth = new Auth(config.authUrl, credentials.IN.billingId, credentials.IN.clientId, credentials.IN.secret);
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
                "Authorization": this.auth.getBearerHeaderValue(),
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

/**
 * Start up a websocket receiver
 *
 * @param config overrides for default configs.
 * @param callback the function to be called with a decoded message.
 * @constructor
 */
function WsReceiver(config, callback) {
    config = setupDefaults(config);
    this.egressUrl = config.egressUrl; //"ws://egress-internal.core.svc";
    this.schemaUrl = config.schemaUrl;
    this.schemaCache = {}
    this.callback = callback;

    /**
     * initialize the Websocket receiver.
     * @param streamnr
     * @returns {Promise<unknown>}
     */
    this.init = function(streamnr){
        return new Promise((resolve,reject) => {
            fs.readFile(config.credentialsFile).then(data => {
                let credentials = JSON.parse(data);
                let billingId = credentials.IN.billingId;
                credentials = streamnr === undefined ? credentials.IN : credentials.OUT[streamnr];
                this.auth = new Auth(config.authUrl, billingId, credentials.clientId, credentials.secret);
                this.auth.authenticate().then( _ => {
                    this.connect_ws();
                    resolve(this);
                }).catch(error => reject(error))
            });
        })
    }
    this.connect_ws = function() {
        this.ws = new Websocket(`${this.egressUrl}/ws`, {
            headers: { Authorization: this.auth.getBearerHeaderValue() }
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
            // for other Avro message formats (like Single Object Encoding)
            // https://avro.apache.org/docs/current/spec.html#single_object_encoding_spec
            // this needs to be slightly different
            let confluentSchemaId = buf.readUInt32BE(1);
            let avroData = buf.slice(5)

            this.getSchemaById(confluentSchemaId)
                .then(schema => this.callback(schema.fromBuffer(avroData)))
                .catch(error=> console.error(error))
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
                    console.log(`Retrieved schema for ${schemaId}`)
                    resolve(avro.Type.forSchema(JSON.parse(result.data.schema)));
                })
                .catch(error=>reject(error))
            })
        }
        return this.schemaCache[schemaId];
    }
}

module.exports = {Sender, WsReceiver}