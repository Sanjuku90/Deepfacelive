import { Router, type IRouter } from "express";
import healthRouter from "./health";
import avatarsRouter from "./avatars";

const router: IRouter = Router();

router.use(healthRouter);
router.use(avatarsRouter);

export default router;
