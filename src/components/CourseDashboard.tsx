import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BookOpen, Plus, Trash2, Pencil, Check, X, ChevronRight,
  GraduationCap, Calendar, BarChart2, FileText,
} from 'lucide-react';
import { cn } from '../utils';
import type { Course } from '../types';

interface Props {
  courses: Course[];
  onOpen: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
}

function courseProgress(course: Course): number {
  if (!course.plan || course.plan.chapters.length === 0) return 0;
  return Math.round((course.studiedChapters.length / course.plan.chapters.length) * 100);
}

export function CourseDashboard({ courses, onOpen, onCreate, onRename, onDelete }: Props) {
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setNewName('');
    setShowNewDialog(false);
  };

  const handleStartRename = (course: Course) => {
    setRenamingId(course.id);
    setRenameValue(course.name);
  };

  const handleConfirmRename = () => {
    if (renamingId && renameValue.trim()) {
      onRename(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  const handleDelete = (id: string) => {
    onDelete(id);
    setConfirmDeleteId(null);
  };

  return (
    <motion.div
      key="dashboard"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-4xl mx-auto"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">
            Mijn Vakken
          </h2>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {courses.length === 0
              ? 'Begin met je eerste vak'
              : `${courses.length} vak${courses.length !== 1 ? 'ken' : ''}`}
          </p>
        </div>
        <button
          onClick={() => setShowNewDialog(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold rounded-xl shadow-md shadow-orange-500/20 hover:scale-105 transition-all"
        >
          <Plus className="w-5 h-5" />
          Nieuw vak
        </button>
      </div>

      {/* Empty state */}
      {courses.length === 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-24 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-3xl"
        >
          <div className="w-20 h-20 bg-orange-50 dark:bg-orange-950/30 rounded-full flex items-center justify-center mx-auto mb-6">
            <GraduationCap className="w-10 h-10 text-orange-500" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">Geen vakken gevonden</h3>
          <p className="text-gray-500 dark:text-gray-400 mb-8 max-w-sm mx-auto">
            Maak je eerste vak aan en upload de bijbehorende documenten om een interactief studieplan te genereren.
          </p>
          <button
            onClick={() => setShowNewDialog(true)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold rounded-xl shadow-md shadow-orange-500/20 hover:scale-105 transition-all"
          >
            <Plus className="w-5 h-5" />
            Maak je eerste vak
          </button>
        </motion.div>
      )}

      {/* Course grid */}
      {courses.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <AnimatePresence>
            {courses.map(course => {
              const progress = courseProgress(course);
              const chapterCount = course.plan?.chapters.length ?? 0;
              const topicCount = course.plan?.topics.length ?? 0;
              const isRenaming = renamingId === course.id;
              const isConfirmDelete = confirmDeleteId === course.id;

              return (
                <motion.div
                  key={course.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-4"
                >
                  {/* Top row: name + actions */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 bg-orange-100 dark:bg-orange-950/40 rounded-xl flex items-center justify-center shrink-0">
                        <BookOpen className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                      </div>
                      {isRenaming ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleConfirmRename();
                              if (e.key === 'Escape') setRenamingId(null);
                            }}
                            className="flex-1 text-sm font-semibold border border-orange-300 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-orange-400 bg-white dark:bg-gray-800 dark:text-gray-100"
                          />
                          <button onClick={handleConfirmRename} className="text-emerald-600 hover:text-emerald-700">
                            <Check className="w-4 h-4" />
                          </button>
                          <button onClick={() => setRenamingId(null)} className="text-gray-400 hover:text-gray-600">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <div className="min-w-0">
                          <h3 className="font-bold text-gray-900 dark:text-gray-100 truncate">{course.name}</h3>
                          <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1 mt-0.5">
                            <Calendar className="w-3 h-3" />
                            {formatDate(course.updatedAt)}
                          </p>
                        </div>
                      )}
                    </div>
                    {!isRenaming && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleStartRename(course)}
                          className="p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                          title="Hernoemen"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(course.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                          title="Verwijderen"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Stats */}
                  {course.plan ? (
                    <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400">
                      <span className="flex items-center gap-1">
                        <FileText className="w-3.5 h-3.5" />
                        {topicCount} onderwerp{topicCount !== 1 ? 'en' : ''}
                      </span>
                      <span className="flex items-center gap-1">
                        <BookOpen className="w-3.5 h-3.5" />
                        {chapterCount} hoofdstuk{chapterCount !== 1 ? 'ken' : ''}
                      </span>
                      <span className="flex items-center gap-1">
                        <BarChart2 className="w-3.5 h-3.5" />
                        {progress}% klaar
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 dark:text-gray-500 italic">Nog geen studieplan gegenereerd</p>
                  )}

                  {/* Progress bar */}
                  {course.plan && (
                    <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-orange-400 to-orange-500 rounded-full transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}

                  {/* Source files */}
                  {course.sourceFileNames.length > 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                      {course.sourceFileNames.slice(0, 3).join(', ')}
                      {course.sourceFileNames.length > 3 && ` +${course.sourceFileNames.length - 3} meer`}
                    </p>
                  )}

                  {/* Delete confirm */}
                  {isConfirmDelete ? (
                    <div className="flex items-center gap-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-3">
                      <p className="text-xs text-red-700 dark:text-red-400 flex-1">
                        Weet je zeker dat je <strong>{course.name}</strong> wilt verwijderen?
                      </p>
                      <button
                        onClick={() => handleDelete(course.id)}
                        className="text-xs font-bold text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Verwijder
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="text-xs font-medium text-gray-500 hover:text-gray-700 px-2 py-1.5 rounded-lg transition-colors"
                      >
                        Annuleer
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => onOpen(course.id)}
                      className={cn(
                        "w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-all",
                        course.plan
                          ? "bg-orange-500 hover:bg-orange-600 text-white shadow-sm shadow-orange-500/20"
                          : "bg-gray-100 dark:bg-gray-800 hover:bg-orange-50 dark:hover:bg-orange-950/30 text-gray-700 dark:text-gray-300 hover:text-orange-600 dark:hover:text-orange-400"
                      )}
                    >
                      {course.plan ? 'Ga verder' : 'Bestanden toevoegen'}
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* New course dialog */}
      <AnimatePresence>
        {showNewDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowNewDialog(false)}
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-6 w-full max-w-sm border border-gray-200 dark:border-gray-700"
            >
              <h3 className="font-extrabold text-xl text-gray-900 dark:text-gray-100 mb-4">Nieuw vak</h3>
              <input
                autoFocus
                type="text"
                placeholder="Naam van het vak (bijv. Statistiek 1)"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') setShowNewDialog(false);
                }}
                className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-orange-400 bg-white dark:bg-gray-800 dark:text-gray-100 mb-4"
              />
              <div className="flex gap-3">
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim()}
                  className="flex-1 py-2.5 bg-gradient-to-r from-orange-500 to-orange-600 text-white font-semibold rounded-xl disabled:opacity-50 hover:scale-105 transition-all"
                >
                  Aanmaken
                </button>
                <button
                  onClick={() => { setShowNewDialog(false); setNewName(''); }}
                  className="px-4 py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-medium rounded-xl hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  Annuleer
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
