"use strict";
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


function Client() {
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

module.exports = Client