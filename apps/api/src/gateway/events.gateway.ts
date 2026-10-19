import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import {
  WS_EVENTS,
  type WsPingPayload,
  type WsPongPayload,
} from '@holoraa/shared';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/',
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(EventsGateway.name);

  handleConnection(client: Socket): void {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage(WS_EVENTS.PING)
  handlePing(
    @ConnectedSocket() _client: Socket,
    @MessageBody() payload: WsPingPayload,
  ): { event: string; data: WsPongPayload } {
    return {
      event: WS_EVENTS.PONG,
      data: {
        timestamp: payload?.timestamp ?? Date.now(),
        serverTime: Date.now(),
      },
    };
  }
}
