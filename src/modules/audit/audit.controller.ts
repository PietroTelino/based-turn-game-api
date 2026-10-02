import { Request, Response } from 'express';
import { AuditService } from './audit.service';

export class AuditController {
  private service = new AuditService();

  list = async (req: Request, res: Response) => {
    try {
      const {
        userId,
        performedById,
        action,
        entity,
        limit = '100',
        offset = '0',
      } = req.query;

      const audits = await this.service.list({
        userId: userId as string,
        performedById: performedById as string,
        action: action as string,
        entity: entity as string,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      });

      const total = await this.service.count({
        userId: userId as string,
        performedById: performedById as string,
        action: action as string,
        entity: entity as string,
      });

      return res.json({
        data: audits,
        pagination: {
          total,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
        },
      });
    } catch (error: any) {
      console.error(error);
      return res.status(500).json({ message: 'Erro ao listar logs de auditoria' });
    }
  };

  getById = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ message: 'ID é obrigatório' });
      }

      const audit = await this.service.getById(id);
      if (!audit) {
        return res.status(404).json({ message: 'Log de auditoria não encontrado' });
      }

      return res.json(audit);
    } catch (error: any) {
      console.error(error);
      return res.status(500).json({ message: 'Erro ao buscar log de auditoria' });
    }
  };

  getMyAudits = async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Não autenticado' });
      }

      const { limit = '100', offset = '0' } = req.query;

      const audits = await this.service.list({
        userId: req.user.id,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
      });

      const total = await this.service.count({
        userId: req.user.id,
      });

      return res.json({
        data: audits,
        pagination: {
          total,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
        },
      });
    } catch (error: any) {
      console.error(error);
      return res.status(500).json({ message: 'Erro ao listar seus logs de auditoria' });
    }
  };
}