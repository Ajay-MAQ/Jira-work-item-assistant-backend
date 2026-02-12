import { Request, Response, NextFunction } from "express";

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // For now: only format validation
  const auth = req.headers.authorization;

  if (auth && !auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Invalid auth format" });
  }

  next();
}
