"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button, Dialog, useToast } from "@/components/ui";
import { deletePhase0Document } from "@/lib/phase0/client";
import { getDocumentDeletionErrorMessage, isDocumentNotFoundError } from "@/lib/phase0/document-deletion";
import { routes } from "@/lib/routes";

interface DeleteDocumentButtonProps {
  readonly documentId: string;
  readonly documentName: string;
}

export function DeleteDocumentButton({ documentId, documentName }: DeleteDocumentButtonProps) {
  const router = useRouter();
  const { notify } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const isDeletingRef = useRef(false);

  const openDialog = useCallback((): void => {
    setDeletionError(null);
    setIsDialogOpen(true);
  }, []);

  const closeDialog = useCallback((): void => {
    if (isDeletingRef.current) {
      return;
    }
    setIsDialogOpen(false);
    triggerRef.current?.focus();
  }, []);

  const confirmDeletion = useCallback(async (): Promise<void> => {
    if (isDeletingRef.current) {
      return;
    }
    isDeletingRef.current = true;
    setIsDeleting(true);
    setDeletionError(null);

    try {
      await deletePhase0Document(documentId);
      notify("Đã xóa tài liệu.", "success");
      router.replace(routes.library);
    } catch (error: unknown) {
      if (isDocumentNotFoundError(error)) {
        notify("Tài liệu này đã được xóa trước đó.", "info");
        router.replace(routes.library);
        return;
      }
      setDeletionError(getDocumentDeletionErrorMessage(error));
      isDeletingRef.current = false;
      setIsDeleting(false);
    }
  }, [documentId, notify, router]);

  return (
    <>
      <Button ref={triggerRef} type="button" variant="outline" onClick={openDialog}>
        <Trash2 className="h-4 w-4" aria-hidden />
        Xóa tài liệu
      </Button>

      <Dialog
        open={isDialogOpen}
        onClose={closeDialog}
        title="Xóa tài liệu này?"
        footer={(
          <>
            <Button type="button" variant="outline" onClick={closeDialog} disabled={isDeleting}>
              Giữ lại
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                void confirmDeletion();
              }}
              disabled={isDeleting}
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />}
              {isDeleting ? "Đang xóa…" : "Xóa vĩnh viễn"}
            </Button>
          </>
        )}
      >
        <div className="space-y-3 text-sm leading-6 text-ink-600">
          <p>
            Tài liệu <span className="break-words font-semibold text-ink-900">{documentName}</span> và tệp gốc
            sẽ bị xóa khỏi thư viện của bạn.
          </p>
          <p>Bạn không thể hoàn tác thao tác này. Nếu tài liệu đang được xử lý, quá trình xử lý sẽ dừng lại.</p>
          {deletionError ? (
            <p className="rounded-2xl border border-error-100 bg-error-50 p-3 text-error-700" role="alert">
              {deletionError}
            </p>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
