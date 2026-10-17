import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { editorExtensions } from '../lib/editor-extensions';
import { z } from 'zod';
import { api } from '../lib/api-client';
import { editorPostSchema, type EditorPost } from '../lib/editor-model';
import { Button, buttonVariants } from './ui/button';
import { Input } from './ui/input';
import { Field, FieldGroup, FieldLabel, FieldError } from './ui/field';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from './ui/alert-dialog';
import { Checkbox } from './ui/checkbox';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { ShopDesignField } from './ShopDesignField';
import { shopDesignSchema } from '../lib/shop-design';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip';

const mediaSchema = z.object({
  id: z.string(),
  status: z.string(),
  data: z.object({
    title: z.string(),
    kind: z.enum(['photo', 'video']),
    asset: z.object({ id: z.string(), url: z.string().optional() }).nullish(),
    poster: z.object({ src: z.string().optional() }).nullish(),
    source_url: z.string().nullish(),
    poster_url: z.string().nullish(),
  }),
});
type Media = z.infer<typeof mediaSchema>;

function EditorForm({
  post,
  onSaved,
}: {
  post: EditorPost;
  onSaved: (post: EditorPost) => void;
}) {
  const [items, setItems] = useState<Media[]>([]);
  const [gallery, setGallery] = useState(post.data.gallery);
  const [shopDesign, setShopDesign] = useState(post.data.shop_design ?? null);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const deleted = useRef(false);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const [action, setAction] = useState<'unpublish' | 'delete'>();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [dirty, setDirty] = useState(false);
  const editGeneration = useRef(0);
  function markDirty() {
    editGeneration.current++;
    setDirty(true);
    setStatus('');
  }
  const [pickerOpen, setPickerOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  const [linkError, setLinkError] = useState('');
  const editor = useEditor({
    extensions: editorExtensions,
    content: post.data.document,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          'rich-text min-h-[360px] p-4 outline-none [&_p]:mb-4 [&_h2]:mb-4 [&_h2]:text-base [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_a]:underline [&_img]:my-4 [&_img]:max-w-full [&_video]:my-4 [&_video]:max-w-full',
        role: 'textbox',
        'aria-label': 'Post content',
        'aria-multiline': 'true',
      },
    },
    onUpdate: () => {
      markDirty();
    },
  });
  const formatting = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive('bold') || false,
      italic: current?.isActive('italic') || false,
    }),
  });
  useEffect(() => {
    let cancelled = false;
    api('/api/trip/media')
      .then((data) => {
        if (!cancelled)
          setItems(
            z
              .object({ items: z.array(mediaSchema) })
              .parse(data)
              .items.filter((item) => item.status === 'published'),
          );
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setStatus(
            error instanceof Error ? error.message : 'Could not load media',
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty && !deleted.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('beforeunload', leave);
    };
  }, [dirty]);
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || busy.current) return;
    if (shopDesign && !shopDesignSchema.safeParse(shopDesign).success) {
      setStatus('use a product link from shop.bent.build');
      return;
    }
    const values = new FormData(event.currentTarget),
      submitted = event.nativeEvent;
    const publish =
      submitted.submitter instanceof HTMLButtonElement &&
      submitted.submitter.dataset.publish === 'true';
    busy.current = true;
    setSaving(true);
    const submittedGeneration = editGeneration.current;
    try {
      const result = z
        .object({
          post: editorPostSchema,
          publicationError: z.string().optional(),
        })
        .parse(
          await api('/api/trip/posts', {
            id: post.id || undefined,
            revision: post.revision || undefined,
            title: values.get('title'),
            day: values.get('day'),
            place: values.get('place'),
            gallery,
            shop_design: shopDesign,
            document: editor.getJSON(),
            publish,
          }),
        );
      const saved = result.post;
      const newerEdits = editGeneration.current !== submittedGeneration;
      setDirty(newerEdits);
      onSaved(saved);
      setStatus(
        [
          result.publicationError || (publish ? 'published' : 'draft saved'),
          ...(newerEdits ? ['newer edits unsaved'] : []),
        ].join('\n'),
      );
      if (!post.id) history.replaceState(null, '', `/owner/posts/${saved.id}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  async function mutatePost(nextAction: 'unpublish' | 'delete') {
    if (!post.id || busy.current) return;
    busy.current = true;
    setSaving(true);
    setAction(nextAction);
    setDeleteError('');
    setStatus('');
    const submittedGeneration = editGeneration.current;
    const path = `/_emdash/api/content/posts/${encodeURIComponent(post.id)}`;
    try {
      if (nextAction === 'unpublish') {
        const result = z
          .object({
            data: z.object({
              _rev: z.string(),
              item: z.object({ status: z.string() }),
            }),
          })
          .parse(await api(`${path}/unpublish`, { _rev: post.revision }));
        onSaved({
          ...post,
          revision: result.data._rev,
          status: result.data.item.status,
        });
        setStatus(
          [
            'unpublished',
            ...(dirty || editGeneration.current !== submittedGeneration
              ? ['unsaved edits']
              : []),
          ].join('\n'),
        );
      } else {
        await api(path, undefined, 'DELETE');
        deleted.current = true;
        window.location.assign('/owner');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed';
      if (nextAction === 'delete') setDeleteError(message);
      else setStatus(message);
    } finally {
      busy.current = false;
      setSaving(false);
      setAction(undefined);
    }
  }
  return (
    <form
      onSubmit={(event) => {
        void save(event);
      }}
      onChange={() => {
        markDirty();
      }}
      className="space-y-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>edit post</h1>
        <Badge variant="outline">{post.status}</Badge>
      </div>
      <div className="grid grid-cols-1 gap-6 min-[901px]:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="post-title">title</FieldLabel>
            <Input
              id="post-title"
              name="title"
              defaultValue={post.data.title}
              required
              maxLength={200}
            />
          </Field>
          <div className="border" data-feedback-id="rich-text-editor">
            <TooltipProvider>
              <div className="flex flex-wrap items-center gap-2 border-b p-2">
                <ToggleGroup
                  multiple
                  value={[
                    ...(formatting?.bold ? ['bold'] : []),
                    ...(formatting?.italic ? ['italic'] : []),
                  ]}
                  variant="outline"
                >
                  <ToggleGroupItem
                    value="bold"
                    aria-label="Bold"
                    onClick={() => editor?.chain().focus().toggleBold().run()}
                  >
                    B
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="italic"
                    aria-label="Italic"
                    onClick={() => editor?.chain().focus().toggleItalic().run()}
                  >
                    I
                  </ToggleGroupItem>
                </ToggleGroup>
                <Separator orientation="vertical" className="h-6" />
                <Tooltip>
                  <TooltipTrigger
                    render={<Button type="button" size="sm" />}
                    onClick={() =>
                      editor?.chain().focus().toggleHeading({ level: 2 }).run()
                    }
                  >
                    H2
                  </TooltipTrigger>
                  <TooltipContent>heading</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={<Button type="button" size="sm" />}
                    onClick={() =>
                      editor?.chain().focus().toggleBulletList().run()
                    }
                  >
                    LIST
                  </TooltipTrigger>
                  <TooltipContent>bullet list</TooltipContent>
                </Tooltip>
                <Dialog
                  open={linkOpen}
                  onOpenChange={(open) => {
                    setLinkOpen(open);
                    setLinkError('');
                    if (open) {
                      const current: unknown =
                        editor?.getAttributes('link').href;
                      setHref(typeof current === 'string' ? current : '');
                    }
                  }}
                >
                  <DialogTrigger render={<Button type="button" size="sm" />}>
                    LINK
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>link</DialogTitle>
                    </DialogHeader>
                    <Field>
                      <FieldLabel htmlFor="post-link">url</FieldLabel>
                      <Input
                        id="post-link"
                        type="url"
                        value={href}
                        onChange={(event) => {
                          setHref(event.target.value);
                        }}
                        aria-invalid={Boolean(linkError)}
                      />
                      {linkError && <FieldError>{linkError}</FieldError>}
                    </Field>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="default"
                        onClick={() => {
                          const parsed = z.url().safeParse(href);
                          if (
                            !parsed.success ||
                            !['http:', 'https:'].includes(
                              new URL(parsed.data).protocol,
                            )
                          ) {
                            setLinkError('url required');
                            return;
                          }
                          editor
                            ?.chain()
                            .focus()
                            .extendMarkRange('link')
                            .setLink({ href: parsed.data })
                            .run();
                          setLinkOpen(false);
                        }}
                      >
                        APPLY
                      </Button>
                      <Button
                        type="button"
                        onClick={() => {
                          editor?.chain().focus().unsetLink().run();
                          setLinkOpen(false);
                        }}
                      >
                        REMOVE
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
                <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
                  <DialogTrigger render={<Button type="button" size="sm" />}>
                    + MEDIA
                  </DialogTrigger>
                  <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
                    <DialogHeader>
                      <DialogTitle>media</DialogTitle>
                    </DialogHeader>
                    <a href="/owner/media" className="underline">
                      UPLOAD / EDIT MEDIA →
                    </a>
                    <div className="trip-gallery-field">
                      <div className="trip-gallery-options grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {items.map((item) => (
                          <div key={item.id} className="space-y-2">
                            <img
                              src={
                                item.data.poster?.src ||
                                item.data.poster_url ||
                                item.data.asset?.url ||
                                item.data.source_url ||
                                ''
                              }
                              alt={item.data.title}
                              className="aspect-[1.15] w-full object-cover"
                            />
                            <Field orientation="horizontal">
                              <Checkbox
                                id={`post-gallery-${item.id}`}
                                checked={gallery.includes(item.id)}
                                onCheckedChange={(checked) => {
                                  setGallery((current) =>
                                    checked
                                      ? [...current, item.id]
                                      : current.filter((id) => id !== item.id),
                                  );
                                  markDirty();
                                }}
                              />
                              <FieldLabel htmlFor={`post-gallery-${item.id}`}>
                                gallery
                              </FieldLabel>
                            </Field>
                            <Button
                              type="button"
                              size="sm"
                              disabled={!item.data.asset}
                              onClick={() => {
                                if (!editor || !item.data.asset) return;
                                const mediaNode = {
                                  type:
                                    item.data.kind === 'video'
                                      ? 'videoBlock'
                                      : 'image',
                                  attrs: {
                                    src:
                                      item.data.source_url ||
                                      item.data.asset.url,
                                    mediaId: item.data.asset.id,
                                    provider: 'local',
                                    alt: item.data.title,
                                  },
                                };
                                const { $from } = editor.state.selection;
                                const chain = editor.chain().focus();
                                if ($from.depth > 1)
                                  chain
                                    .insertContentAt($from.after(1), mediaNode)
                                    .run();
                                else chain.insertContent(mediaNode).run();
                                setPickerOpen(false);
                              }}
                            >
                              INSERT IN POST
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </TooltipProvider>
            <EditorContent editor={editor} />
          </div>
          {gallery.length > 0 && (
            <div className="grid grid-cols-3 gap-2" aria-label="Post gallery">
              {items
                .filter((item) => gallery.includes(item.id))
                .map((item) => (
                  <img
                    key={item.id}
                    src={
                      item.data.poster?.src ||
                      item.data.poster_url ||
                      item.data.asset?.url ||
                      item.data.source_url ||
                      ''
                    }
                    alt={item.data.title}
                    className="aspect-[1.15] w-full object-cover"
                  />
                ))}
            </div>
          )}
        </div>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="post-day">day</FieldLabel>
            <Input
              id="post-day"
              name="day"
              type="date"
              defaultValue={post.data.day}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="post-place">place</FieldLabel>
            <Input
              id="post-place"
              name="place"
              defaultValue={post.data.place}
            />
          </Field>
          <Separator />
          <ShopDesignField
            value={shopDesign}
            onChange={(value) => {
              setShopDesign(value);
              markDirty();
            }}
          />
          <Separator />
          <Button type="submit" disabled={saving || !editor}>
            SAVE DRAFT
          </Button>
          <Button
            type="submit"
            data-publish="true"
            variant="default"
            disabled={saving || !editor}
          >
            PUBLISH
          </Button>
          {post.id && post.status === 'published' && (
            <a
              href={`/posts/${post.id}`}
              className={buttonVariants({ variant: 'link' })}
            >
              VIEW POST
            </a>
          )}
          {post.id && (
            <>
              <Separator />
              {(post.status === 'published' || post.status === 'scheduled') && (
                <Button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    void mutatePost('unpublish');
                  }}
                >
                  {action === 'unpublish' ? 'UNPUBLISHING' : 'UNPUBLISH'}
                </Button>
              )}
              <AlertDialog
                open={deleteOpen}
                onOpenChange={(open, details) => {
                  if (busy.current) {
                    details.cancel();
                    return;
                  }
                  setDeleteOpen(open);
                  setDeleteError('');
                }}
              >
                <AlertDialogTrigger
                  render={<Button type="button" disabled={saving} />}
                >
                  DELETE POST
                </AlertDialogTrigger>
                <AlertDialogContent initialFocus={cancelDelete}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>delete post?</AlertDialogTitle>
                    <AlertDialogDescription>
                      moves this post to trash and removes it from the blog.
                      media stays in the library.
                      {dirty && ' unsaved edits will be discarded.'}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  {deleteError && <p role="alert">{deleteError}</p>}
                  <AlertDialogFooter>
                    <AlertDialogCancel
                      ref={cancelDelete}
                      type="button"
                      disabled={saving}
                    >
                      CANCEL
                    </AlertDialogCancel>
                    <AlertDialogAction
                      type="button"
                      variant="default"
                      disabled={saving}
                      onClick={() => {
                        void mutatePost('delete');
                      }}
                    >
                      {action === 'delete' ? 'DELETING' : 'DELETE'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
          <p className="whitespace-pre-wrap empty:hidden" role="status">
            {status}
          </p>
        </FieldGroup>
      </div>
    </form>
  );
}
export function OwnerEditor({ id, day }: { id?: string; day: string }) {
  const [post, setPost] = useState<EditorPost>();
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setPost({
        id: '',
        revision: '',
        status: 'draft',
        data: {
          title: '',
          day,
          place: '',
          gallery: [],
          document: { type: 'doc', content: [{ type: 'paragraph' }] },
        },
      });
      return;
    }
    api(`/api/trip/posts?id=${encodeURIComponent(id)}`)
      .then((data) => {
        if (!cancelled) setPost(editorPostSchema.parse(data));
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(
            reason instanceof Error ? reason.message : 'Could not load post',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [id, day]);
  return post ? (
    <EditorForm post={post} onSaved={setPost} />
  ) : (
    <div className="space-y-3">
      <p role="status">{error || 'loading'}</p>
      {error && id && (
        <a
          className={buttonVariants()}
          href={`/_emdash/admin/content/posts/${encodeURIComponent(id)}`}
        >
          OPEN IN CMS
        </a>
      )}
    </div>
  );
}
