module.exports = function (moin, settings) {


    let logger = moin.getLogger("remote");

    if (["dynamic", "client", "server"].indexOf(settings.mode) == -1) {
        logger.error("Mode has to be 'dynamic', 'client' or 'server'.");
        return;
    }

    const me = require("hat")();
    let connections = new Map();

    let time = 0;

    let mode = null;

    function registerHandler(id, socket, onDC = null) {
        let handler = moin.registerEventHandler((event, bestMatch = false)=> {
            if (event._source == id) {
                return bestMatch ? {id: null, score: -1} : [];
            } else {
                return new Promise((resolve, reject)=> {
                    event._source = me;
                    socket.emit("event.collect", {event, bestMatch}, (handler)=> {
                        if (bestMatch) {
                            if (handler.score != -1) {
                                handler.id = "net:" + id + ":" + handler.id;
                            }
                        } else {
                            handler = handler.map((h)=> {
                                h.id = "net:" + id + ":" + h.id;
                                return h;
                            });
                        }
                        resolve(handler);
                    });
                });
            }
        }, (check)=> {
            let [net,socketId,hId] = check.split(":");
            logger.info(net, socketId, id);
            if (net == "net" && socketId == id) {
                return (event)=>new Promise((resolve, reject)=> {
                    socket.emit("event.exec", {id: hId, event}, function (res) {
                        if (res.state == 1) {
                            resolve(res.value);
                        } else {
                            reject(res.error);
                        }
                    });
                });
            }
        });

        let collect = ({event,bestMatch}, callback)=> {
            moin.collectEventHandlerIds(event, bestMatch).then(callback);
        };

        let exec = ({event,id}, callback)=> {
            moin.execEventHandlerById(id, event).then((data)=> {
                callback(data);
            });
        };

        socket.on("event.collect", collect);
        socket.on("event.exec", exec);
        let dc = ()=> {
            socket.removeListener("event.collect", collect);
            socket.removeListener("event.exec", exec);
            socket.removeListener("disconnect", dc);
            moin.removeEventHandler(handler);
            if (onDC != null)onDC();
        };
        socket.on("disconnect", dc);
    }

    moin.registerMethod("connect", (url)=> {
        if (mode != null)return Promise.reject("Connection already open");
        return new Promise((resolve, reject)=> {
            var socket = require('socket.io-client')(url);
            socket.on("me", (id)=> {
                logger.info("Connected to Server:", id);
                socket.emit("me", me);
                registerHandler(id, socket, ()=>logger.info("Disconnected from Server: " + id));
            });
        });
    });
    moin.registerMethod("listen", (port)=> {
        if (mode != null)return Promise.reject("Connection already open");
        return new Promise((resolve, reject)=> {
            var io = require('socket.io')();
            io.on('connection', function (socket) {
                socket.emit("me", me);
                socket.on("me", id=> {
                    logger.info("Client connected: " + id);
                    registerHandler(id, socket, ()=>logger.info("Client disconnected: " + id));
                });
            });
            io.listen(port);
            resolve();
        });
    });

    switch (settings.mode) {
        case "client":
            moin.connect("http://" + settings.host + ":" + settings.port);
            break;
        case "server":
            moin.listen(settings.port);
            break;
    }

};