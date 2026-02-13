const { PeerServer } = require('peer');

const peerServer = PeerServer({
  port: 9000,
  path: '/peerjs',
  ssl: false,  // 如果需要 HTTPS 设为 true
  proxied: false,  // 如果通过代理设为 true
  allow_discovery: true,  // 是否允许发现其他 peer
  // key: '',  // API 密钥（可选）
  
  // CORS 配置
  corsOptions: {
    origin: '*',  // 允许所有来源，生产环境应限制
    methods: ['GET', 'POST']
  }
});

console.log('PeerJS 服务器运行在端口 9000');