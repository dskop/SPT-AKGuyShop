import { DependencyContainer } from "tsyringe";

// SPT types
import { IPreSptLoadMod } from "@spt/models/external/IPreSptLoadMod";
import { IPostDBLoadMod } from "@spt/models/external/IPostDBLoadMod";
import { ILogger } from "@spt/models/spt/utils/ILogger";
import { PreSptModLoader } from "@spt/loaders/PreSptModLoader";
import { DatabaseServer } from "@spt/servers/DatabaseServer";
import { ImageRouter } from "@spt/routers/ImageRouter";
import { ConfigServer } from "@spt/servers/ConfigServer";
import { ConfigTypes } from "@spt/models/enums/ConfigTypes";
import { ITraderConfig } from "@spt/models/spt/config/ITraderConfig";
import { IRagfairConfig } from "@spt/models/spt/config/IRagfairConfig";
import { JsonUtil } from "@spt/utils/JsonUtil";
import { Money } from "@spt/models/enums/Money";
import { Traders } from "@spt/models/enums/Traders";
import { HashUtil } from "@spt/utils/HashUtil";
import { ItemHelper } from "@spt/helpers/ItemHelper"
import { IDatabaseTables } from "@spt/models/spt/server/IDatabaseTables";
import { Item } from "@spt/models/eft/common/tables/IItem";

import { TraderHelper } from "./traderHelpers";
import { FluentAssortConstructor as FluentAssortCreator } from "./fluentTraderAssortCreator";
import * as baseJson from "../db/base.json";
import * as assortmentJson from "../db/assort.json";

class SampleTrader implements IPreSptLoadMod, IPostDBLoadMod 
{
    private mod: string
    private logger: ILogger
    private traderHelper: TraderHelper
    private fluentAssortCreator: FluentAssortCreator

    constructor() {
        this.mod = "akguyshopts"; // Set name of mod so we can log it to console later
    }

    /**
     * Some work needs to be done prior to SPT code being loaded, registering the profile image + setting trader update time inside the trader config json
     * @param container Dependency container
     */
    public preSptLoad(container: DependencyContainer): void 
    {
        // Get a logger
        this.logger = container.resolve<ILogger>("WinstonLogger");
        this.logger.debug(`[${this.mod}] preAki Loading... `);

        // Get SPT code/data we need later
        const preSptModLoader: PreSptModLoader = container.resolve<PreSptModLoader>("PreSptModLoader");
        const imageRouter: ImageRouter = container.resolve<ImageRouter>("ImageRouter");
        const hashUtil: HashUtil = container.resolve<HashUtil>("HashUtil");
        const configServer = container.resolve<ConfigServer>("ConfigServer");
        const traderConfig: ITraderConfig = configServer.getConfig<ITraderConfig>(ConfigTypes.TRADER);
        const ragfairConfig = configServer.getConfig<IRagfairConfig>(ConfigTypes.RAGFAIR);

        // Create helper class and use it to register our traders image/icon + set its stock refresh time
        this.traderHelper = new TraderHelper();
        this.fluentAssortCreator = new FluentAssortCreator(hashUtil, this.logger);
        this.traderHelper.registerProfileImage(baseJson, this.mod, preSptModLoader, imageRouter, "AKGUY.jpg");
        this.traderHelper.setTraderUpdateTime(traderConfig, baseJson, 3600, 4000);


        // Add trader to trader enum
        Traders[baseJson._id] = baseJson._id;

        // Add trader to flea market
        ragfairConfig.traders[baseJson._id] = true;

        this.logger.debug(`[${this.mod}] preAki Loaded`);
    }
    
    /**
     * Majority of trader-related work occurs after the aki database has been loaded but prior to SPT code being run
     * @param container Dependency container
     */
    public postDBLoad(container: DependencyContainer): void
    {
        this.logger.debug(`[${this.mod}] postDb Loading... `);

        // Resolve SPT classes we'll use
        const databaseServer: DatabaseServer = container.resolve<DatabaseServer>("DatabaseServer");
        const configServer: ConfigServer = container.resolve<ConfigServer>("ConfigServer");
        const jsonUtil: JsonUtil = container.resolve<JsonUtil>("JsonUtil");
        const itemHelper = container.resolve<ItemHelper>("ItemHelper");
        const hashUtil: HashUtil = container.resolve<HashUtil>("HashUtil");

        // Get a reference to the database tables
        const tables = databaseServer.getTables();

        // Add new trader to the trader dictionary in DatabaseServer - has no assorts (items) yet
        this.traderHelper.addTraderToDb(baseJson, tables, jsonUtil);

        this.populateItems(tables, itemHelper, hashUtil);

        // Add trader to locale file, ensures trader text shows properly on screen
        // WARNING: adds the same text to ALL locales (e.g. chinese/french/english)
        this.traderHelper.addTraderToLocales(baseJson, tables, baseJson.name + " " + baseJson.surname, baseJson.name, baseJson.nickname, baseJson.location, "Want some AK?");

        this.logger.debug(`[${this.mod}] postDb Loaded`);
    }

    private getAssortment(hashUtil: HashUtil): Item[] {
        // replace arbitrary _id with mongo id for compatibility with SPT 3.10+
        const legacyItemsIdMap = assortmentJson.items.reduce((map, item) => {
            const legacyId = item._id;
            const itemWithMongoId = {...item, _id: hashUtil.generate()};
            map[legacyId] = itemWithMongoId;
            return map;
        }, {})

        return Object.values(legacyItemsIdMap).map((item: Item) => {
            if (item.parentId === "hideout") {
                return item;
            }

            return { ...item, parentId: legacyItemsIdMap[item.parentId]._id };
        })
    }

    private populateItems(tables: IDatabaseTables, itemHelper: ItemHelper, hashUtil: HashUtil) {
        let assort: Item[] = [];
        
        const items = this.getAssortment(hashUtil);

        for (const assortmentItem of items) {
            if (assortmentItem.parentId === "hideout") {
                if (assort.length) {
                    this.createAssortItem(assort, tables, itemHelper)
                }
                assort = [assortmentItem];
            } else {
                assort.push(assortmentItem)
            }
        }

        if (assort.length) {
            this.createAssortItem(assort, tables, itemHelper)
        }
    }

    private createAssortItem(assort: Item[], tables: IDatabaseTables, itemHelper: ItemHelper) {
        const price = itemHelper.getItemAndChildrenPrice(assort.map(item => item._tpl));
        const priceCoefficient: number = baseJson.price_coefficient;
        const adjustedPrice = Math.floor(price * priceCoefficient);

        this.fluentAssortCreator
            .createComplexAssortItem(assort)
            .addUnlimitedStackCount()
            .addMoneyCost(Money.ROUBLES, adjustedPrice)
            .addLoyaltyLevel(1)
            .export(tables.traders[baseJson._id]);
    }
}

module.exports = { mod: new SampleTrader() }