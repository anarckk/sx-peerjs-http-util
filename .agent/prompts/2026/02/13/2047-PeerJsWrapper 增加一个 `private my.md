session_id:6cf4e523-b2fc-4349-a155-f772dd94928b

PeerJsWrapper 增加一个 `private myPeerId` 负责存储自己的 id

constructor(peerId?: string) 如果外部传入了 peerId 则使用外部的 peerId ，如果外部没有传入，则自己创建一个 uuid 来作为 peerId 

getPeerId() 不必再返回 Promise 了，直接返回 myPeerId 变量就可以了

PeerJsWrapper 要增加断线重连功能，考虑到如果用户本地网络访问故障，连 peerjs server 都访问不了，
要定时每次连接失败1秒后，再次重连 peer server。

任务结束之后，维护 README.md 、记忆、长期记忆