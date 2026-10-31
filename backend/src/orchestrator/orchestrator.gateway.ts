import {
  Ack,
  ClientToServerEvents,
  MiddlemanChunkEvent,
  roomForJob,
  roomForProject,
  ServerToClientEvents,
  WS_NAMESPACE,
} from '@forge/shared';
import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Namespace, Socket } from 'socket.io';
import { z } from 'zod';
import { MiddlemanStreamCache } from '../middleman/middleman-compiler.service';
import { PrismaService } from '../prisma/prisma.service';
import { JobEventsPublisher } from './job-events.publisher';

const SubscribeProjectSchema = z.object({
  projectId: z.string().min(1),
});

const SubscribeJobSchema = z.object({
  jobId: z.string().min(1),
});

type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

@WebSocketGateway({
  namespace: WS_NAMESPACE,
  cors: {
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:4200',
    credentials: true,
  },
})
export class OrchestratorGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(OrchestratorGateway.name);

  @WebSocketServer()
  server!: Namespace<ClientToServerEvents, ServerToClientEvents>;

  constructor(
    private readonly publisher: JobEventsPublisher,
    private readonly streamCache: MiddlemanStreamCache,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(
    server: Namespace<ClientToServerEvents, ServerToClientEvents>,
  ): void {
    this.publisher.bind(server);
    this.logger.log(`Orchestrator WebSocket gateway initialized (${WS_NAMESPACE})`);
  }

  handleConnection(client: TypedSocket): void {
    this.logger.debug(`WS client connected: ${client.id}`);
  }

  handleDisconnect(client: TypedSocket): void {
    this.logger.debug(`WS client disconnected: ${client.id}`);
  }

  @SubscribeMessage('studio:subscribe-project')
  async handleSubscribeProject(
    @ConnectedSocket() client: TypedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack> {
    const parsed = SubscribeProjectSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, error: 'Invalid projectId payload' };
    }

    const project = await this.prisma.project.findUnique({
      where: { id: parsed.data.projectId },
      select: { id: true },
    });
    if (!project) {
      return { ok: false, error: `Project not found: ${parsed.data.projectId}` };
    }

    await client.join(roomForProject(parsed.data.projectId));
    return { ok: true };
  }

  @SubscribeMessage('studio:unsubscribe-project')
  async handleUnsubscribeProject(
    @ConnectedSocket() client: TypedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack> {
    const parsed = SubscribeProjectSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, error: 'Invalid projectId payload' };
    }

    await client.leave(roomForProject(parsed.data.projectId));
    return { ok: true };
  }

  @SubscribeMessage('job:subscribe')
  async handleSubscribeJob(
    @ConnectedSocket() client: TypedSocket,
    @MessageBody() payload: unknown,
  ): Promise<Ack & { replay?: MiddlemanChunkEvent[] }> {
    const parsed = SubscribeJobSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, error: 'Invalid jobId payload' };
    }

    await client.join(roomForJob(parsed.data.jobId));
    const replay = this.streamCache.get(parsed.data.jobId);
    return { ok: true, replay };
  }
}
