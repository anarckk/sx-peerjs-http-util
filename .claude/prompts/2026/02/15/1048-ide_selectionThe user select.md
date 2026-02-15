session_id:0d235ac6-552b-45c9-957c-8a021b5df788

<ide_selection>The user selected the lines 270 to 271 from c:\projects\peerjs-workspace\sx-peerjs-http-util\src\index.ts:
      const dataStr = data !== undefined ? (typeof data === 'object' ? JSON.stringify(data) : String(data)) : '';


This may or may not be related to the current task.</ide_selection>
去掉这个序列化成字符串的逻辑        const dataStr = data !== undefined ? (typeof data === 'object' ? JSON.stringify(data) : String(data)) : '';