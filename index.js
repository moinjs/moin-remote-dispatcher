module.exports = function (moin, settings) {


    let logger = moin.getLogger("remote");

    if (["dynamic", "client", "server"].indexOf(settings.mode) == -1) {
        logger.error("Mode has to be 'dynamic', 'client' or 'server'.");
        return;
    }

    let me = "";
    if (settings.id.length > 0) {
        me = settings.id;
    } else {
        me = require("hat")();
    }

    const token = settings.token;

    var io = null;

    let isServer = false;
    let mode = null;
    let connections = new Map();

    function registerHandler(id, socket, onDC = null) {
        if (isServer)connections.set(id, socket);
        let handler = moin.registerEventHandler((event, bestMatch = false)=> {
            if (event._source == id) {
                return bestMatch ? {id: null, score: -1} : [];
            } else {
                let eventCopy = Object.assign({}, event);
                return new Promise((resolve, reject)=> {
                    eventCopy._source = me;
                    socket.emit("event.collect", {event: eventCopy, bestMatch}, (handler)=> {
                        if (bestMatch) {
                            if (handler.score != -1) {
                                handler.id = "net:" + id + ":" + handler.id;
                            }
                        } else {
                            handler = handler.map((h)=> {
                                let test = h.split(":");
                                if (test.length == 1)h = "net:" + id + ":" + h
                                return h;
                            });
                        }
                        resolve(handler);
                    });
                });
            }
        }, (check)=> {
            let [net,socketId,hId] = check.split(":");
            if (net == "net") {
                if (!isServer) {
                    if (socketId == id)check = hId;
                } else if (isServer && socketId == id) {
                    check = hId;
                }
                return (event)=> new Promise((resolve, reject)=> {
                    socket.emit("event.exec", {id: check, event}, function (res) {
                        if (res == null) {
                            return reject("No Answer from remote Instance");
                        }
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
            moin.collectEventHandlerIds(event, bestMatch).then((data)=> {
                callback(data);
            });
        };

        let exec = ({event,id}, callback)=> {
            let [net,socketId,hId] = id.split(":");
            if (isServer && net == "net") {
                connections.get(socketId).emit("event.exec", {id: hId, event}, callback);
            } else {
                moin.execEventHandlerById(id, event).then((data)=> {
                    callback(data);
                });
            }
        };

        socket.on("event.collect", collect);
        socket.on("event.exec", exec);
        let dc = ()=> {
            socket.removeListener("event.collect", collect);
            socket.removeListener("event.exec", exec);
            socket.removeListener("disconnect", dc);
            connections.delete(id);
            moin.removeEventHandler(handler);
            if (onDC != null)onDC();
        };
        socket.on("disconnect", dc);
    }

    moin.registerMethod("connect", (url)=> {
        if (mode != null)return Promise.reject("Connection already open");
        return new Promise((resolve, reject)=> {
            var socket = require('socket.io-client')(url);
            socket.on("auth_error", ()=> {
                logger.error("Invalid token");
            });
            socket.on("me", (id)=> {
                logger.info("Connected to Server:", id);
                registerHandler(id, socket, ()=>logger.info("Disconnected from Server: " + id));
            });
            socket.on("hello", ()=> {
                socket.emit("me", {id: me, token});
            });
        });
    });
    moin.registerMethod("listen", (port)=> {
        isServer = true;
        if (mode != null)return Promise.reject("Connection already open");
        return new Promise((resolve, reject)=> {
            io = require('socket.io')();
            io.on('connection', function (socket) {
                socket.emit("hello");
                socket.on("me", (data)=> {
                    if (data.token == token) {
                        logger.info("Client connected: " + data.id);
                        socket.emit("me", me);
                        registerHandler(data.id, socket, ()=>logger.info("Client disconnected: " + data.id));
                    } else {
                        socket.emit("auth_error");
                        logger.warn("Client not authed: " + data.id);
                        socket.disconnect();
                    }
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