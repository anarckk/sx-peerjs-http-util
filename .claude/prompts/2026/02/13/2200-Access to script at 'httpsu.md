session_id:6cf4e523-b2fc-4349-a155-f772dd94928b

Access to script at 'https://unpkg.com/peerjs@1.5.5/dist/peerjs.esm.js' from origin 'http://localhost:8080' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
peerjs.esm.js:1  Failed to load resource: net::ERR_FAILED
:8080/favicon.ico:1  Failed to load resource: the server responded with a status of 404 (Not Found)

也许你要反思一下，我们这个库的 e2e 测试应该怎么写，是不是一开始就写错了