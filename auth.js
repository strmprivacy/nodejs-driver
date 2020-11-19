
const axios = require("axios");
const avro = require("avsc");
const fs = require("fs");

let uri = "https" + "://" + "auth.dev.strm.services"
let auth = {
    refresh: undefined
}

function notYetExpired() {
    return auth.refresh !== undefined &&
        auth.refresh.expiresAt > Math.floor(new Date().getTime() / 1000);
}

function authenticate(url, billingid, clientid, secret){
    return new Promise((resolve, reject) => {
        if(notYetExpired()){
            resolve(auth);
        }
        let payload;
        if(auth.refresh === undefined) {
            url = url + "/auth";
            payload = {
                "billingId": billingid,
                "clientId": clientid,
                "clientSecret": secret
            };
        }
        else {
            url = url + "/refresh";
            payload = {
                "refreshToken": auth.refresh.refreshToken
            };
        }

        axios
            .post(url, payload)
            .then(res => {
                if(res.status!==200) {
                    console.debug(`Response ${url}:  ${res.status}`)
                }
                auth.refresh = res.data;
                resolve(auth);
            })
            .catch(error => {
                console.error(error);
                delete auth.refresh;
                reject(error);
            })
    })
}

function getBearerHeaderValue(){
    return auth.refresh.idToken;
}

function send_event(type) {

    let event = {
        abTests: ["abc"],
        eventType: "button x clicked",
        customer: {id: "customer-id"},
        referrer: "https://www.streammachine.io",
        userAgent: "nodjs",
        producerSessionId: "prodsesid",
        conversion: 1,
        url: "https://portal.streammachine.io/",
        strmMeta: {
            timestamp: (new Date()).getTime(),
            schemaId: "clickstream",
            nonce: 0,
            consentLevels: [0, 1, 2],
        }
    }
    const buf = type.toBuffer(event);

    const request_config = {
        method: "post",
        url: "http://gateway-internal.core.svc/event",
        headers: {
            "Authorization": "Bearer " + getBearerHeaderValue(),
            "Content-Type": "application/octet-stream",
            "Strm-Serialization-Type": "application/x-avro-binary",
            "Strm-Schema-Id": "clickstream"
        },
        data: buf
    };
    axios(request_config)
        .then(res => {
            if (res.status !== 204)
                console.log(res.status);
        })
        .catch(error => {
            console.error(error);
        })
}

fs.readFile("strmcatalog_clickstream_schema.avsc", 'utf8', (err, data) => {
    let billingId = "bvd";
    let clientId = "oghh6vqaoiysr4zikxa1yfyn7hbtje";
    let secret = "Vo$s%wl)s2b029z8F(YTgG$aWcs1K*";
    let type = avro.Type.forSchema(JSON.parse(data));
    let ct=0;

    authenticate(uri, billingId, clientId, secret)
        .then(_ => {
            setInterval(() => send_event(type), 10);
        })
        .catch(error => {
            console.error(error);
        })
});


