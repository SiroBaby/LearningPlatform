import { AutoMap } from '@automapper/classes';

export class DocumentQuizResult {
  @AutoMap()
  documentId!: string;

  @AutoMap()
  questionCount!: number;

  @AutoMap()
  quizId!: string;
}
