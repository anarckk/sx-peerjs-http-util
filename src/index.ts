import { Peer, DataConnection } from 'peerjs';
import type { Request, Response, RequestOptions, ServerOptions, RequestHandler, ConnectionData } from './types';

// 内部消息格式
interface InternalMessage {
  type: 'request' | 'response';
  id: string;
  request?: Request;
  response?: Response;
}

/**
 * 发送 HTTP 请求到指定 Peer
 * @param options 请求选项
 * @returns Promise<Response>
 */
export async function request(options: RequestOptions): Promise<Response> {
  const { peerId, request } = options;

  return new Promise((resolve, reject) => {
    // 创建临时 Peer 用于发送请求
    const tempPeer = new Peer();

    // 超时处理
    const timeout = setTimeout(() => {
      conn.close();
      tempPeer.destroy();
      reject(new Error('Request timeout'));
    }, 30000);

    let conn: DataConnection;
    let requestId: string;

    tempPeer.on('open', (id) => {
      // 连接到对端 Peer
      conn = tempPeer.connect(peerId, {
        reliable: true,
      });

      conn.on('open', () => {
        // 生成请求 ID
        requestId = `${tempPeer.id}-${Date.now()}`;

        // 发送请求
        const message: InternalMessage = {
          type: 'request',
          id: requestId,
          request,
        };

        conn.send(message);
      });

      conn.on('data', (data: unknown) => {
        const message = data as InternalMessage;

        if (message.type === 'response' && message.id === requestId) {
          clearTimeout(timeout);
          conn.close();
          tempPeer.destroy();
          resolve(message.response!);
        }
      });

      conn.on('error', (err) => {
        clearTimeout(timeout);
        tempPeer.destroy();
        reject(err);
      });

      conn.on('close', () => {
        clearTimeout(timeout);
        tempPeer.destroy();
      });
    });

    tempPeer.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * 创建 PeerJS HTTP 服务器
 * @param options 服务端选项
 * @param handler 请求处理器
 * @returns 清理函数
 */
export function createServer(
  peer: any, // Peer 实例
  handler: RequestHandler
): () => void {
  const connections = new Set<DataConnection>();

  // 处理传入连接
  peer.on('connection', (conn: DataConnection) => {
    connections.add(conn);

    conn.on('data', async (data: unknown) => {
      const message = data as InternalMessage;

      if (message.type === 'request') {
        try {
          // 调用处理器处理请求
          const response = await handler(message.request!);

          // 发送响应
          const responseMessage: InternalMessage = {
            type: 'response',
            id: message.id,
            response,
          };

          conn.send(responseMessage);
        } catch (error) {
          // 发送错误响应
          const errorResponse: InternalMessage = {
            type: 'response',
            id: message.id,
            response: {
              status: 500,
              data: { error: error instanceof Error ? error.message : 'Unknown error' },
            },
          };

          conn.send(errorResponse);
        }
      }
    });

    conn.on('close', () => {
      connections.delete(conn);
    });

    conn.on('error', () => {
      connections.delete(conn);
    });
  });

  // 返回清理函数
  return () => {
    for (const conn of connections) {
      conn.close();
    }
    connections.clear();
  };
}

// 导出类型
export type { Request, Response, RequestOptions, ServerOptions, RequestHandler, ConnectionData };
