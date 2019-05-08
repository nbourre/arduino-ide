import { injectable, inject } from 'inversify';
import { BoardsService, Board, AttachedBoard, AttachedSerialBoard, AttachedNetworkBoard } from '../common/protocol/boards-service';
import { PlatformSearchReq, PlatformSearchResp, PlatformInstallReq, PlatformInstallResp, PlatformListReq, PlatformListResp } from './cli-protocol/core_pb';
import { CoreClientProvider } from './core-client-provider';
import { BoardListReq, BoardListResp } from './cli-protocol/board_pb';

@injectable()
export class BoardsServiceImpl implements BoardsService {

    @inject(CoreClientProvider)
    protected readonly coreClientProvider: CoreClientProvider;

    protected selectedBoard: AttachedBoard | undefined;

    public async getAttachedBoards(): Promise<{ boards: AttachedBoard[] }> {
        const { client, instance } = await this.coreClientProvider.getClient();

        const req = new BoardListReq();
        req.setInstance(instance);
        const resp = await new Promise<BoardListResp>((resolve, reject) => client.boardList(req, (err, resp) => (!!err ? reject : resolve)(!!err ? err : resp)));

        const serialBoards: AttachedBoard[] = resp.getSerialList().map(b =>  <AttachedSerialBoard>{
            name: b.getName() || "unknown",
            fqbn: b.getFqbn(),
            port: b.getPort(),
            serialNumber: b.getSerialnumber(),
            productID: b.getProductid(),
            vendorID: b.getVendorid()
        });
        const networkBoards: AttachedBoard[] = resp.getNetworkList().map(b => <AttachedNetworkBoard>{
            name: b.getName(),
            fqbn: b.getFqbn(),
            address: b.getAddress(),
            info: b.getInfo(),
            port: b.getPort(),
        });

        return { boards: serialBoards.concat(networkBoards) };
    }

    async selectBoard(board: AttachedBoard): Promise<void> {
        this.selectedBoard = board;
    }

    async getSelectBoard(): Promise<AttachedBoard | undefined> {
        return this.selectedBoard;
    }

    async search(options: { query?: string }): Promise<{ items: Board[] }> {
        const { client, instance } = await this.coreClientProvider.getClient();

        const installedPlatformsReq = new PlatformListReq();
        installedPlatformsReq.setInstance(instance);
        const installedPlatformsResp = await new Promise<PlatformListResp>((resolve, reject) =>
            client.platformList(installedPlatformsReq,  (err, resp) => (!!err ? reject : resolve)(!!err ? err : resp))
        );
        const installedPlatforms = installedPlatformsResp.getInstalledPlatformList();
        console.info("Installed platforms", installedPlatforms);

        const req = new PlatformSearchReq();
        req.setSearchArgs(options.query || "");
        req.setInstance(instance);
        const resp = await new Promise<PlatformSearchResp>((resolve, reject) => client.platformSearch(req, (err, resp) => (!!err ? reject : resolve)(!!err ? err : resp)));

        let items = resp.getSearchOutputList().map(item => {
            let installedVersion: string | undefined;
            const matchingPlatform = installedPlatforms.find(ip => ip.getId().startsWith(`${item.getId()}@`));
            if (!!matchingPlatform) {
                installedVersion = matchingPlatform.getInstalled();
            }

            const result: Board = {
                id: item.getId(),
                name: item.getName(),
                author: item.getAuthor(),
                availableVersions: [ item.getVersion() ],
                description: item.getParagragh(),
                installable: true,
                summary: item.getSentence(),
                installedVersion,
            }
            return result;
        });

        return { items };
    }

    async install(board: Board): Promise<void> {
        const { client, instance } = await this.coreClientProvider.getClient();

        const [ platform, boardName ] = board.id.split(":");

        const req = new PlatformInstallReq();
        req.setInstance(instance);
        req.setArchitecture(boardName);
        req.setPlatformPackage(platform);
        req.setVersion(board.availableVersions[0]);

        console.info("Starting board installation", board);
        const resp = client.platformInstall(req);
        resp.on('data', (r: PlatformInstallResp) => {
            const prog = r.getProgress();
            if (prog) {
                console.info(`downloading ${prog.getFile()}: ${prog.getCompleted()}%`)
            }
        });
        await new Promise<void>((resolve, reject) => {
            resp.on('end', resolve);
            resp.on('error', reject);
        });
        console.info("Board installation done", board);
    }

}
