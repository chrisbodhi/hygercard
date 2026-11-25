//
//  ContentView.swift
//  HygerCard
//
//  Created by Christopher Boette on 11/21/26.
//

import SwiftUI
import SwiftData
internal import System

let b = Blyg(title: "My blyg", authors: ["a"], location: URL(filePath: "http://intertwingle.tm")!)
let post = Post(parent: b, kind: Kind(rawValue: "thread")!, author: ["a"], body: "lorem ipsum", hasQuote: true)


struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @Query private var items: [Item]
    private var posts: [Post] = [post]

    var body: some View {
        NavigationViewWrapper {
            List {
                ForEach(posts) { post in
                    CardView(post: post)
                }
            }
//            List {
//                ForEach(items) { item in
//                    NavigationLink {
//                        Text("Item at \(item.timestamp, format: Date.FormatStyle(date: .numeric, time: .standard))")
//                    } label: {
//                        Text(item.timestamp, format: Date.FormatStyle(date: .numeric, time: .standard))
//                    }
//                }
//                .onDelete(perform: deleteItems)
//            }
#if os(macOS)
            .navigationSplitViewColumnWidth(min: 180, ideal: 200)
#endif
            .toolbar {
#if os(iOS)
                ToolbarItem(placement: .navigationBarTrailing) {
                    EditButton()
                }
#endif
                ToolbarItem {
                    Button(action: addItem) {
                        Label("Add Item", systemImage: "plus")
                    }
                }
            }
        }
    }

    private func addItem() {
        withAnimation {
            let newItem = Item(timestamp: Date())
            modelContext.insert(newItem)
        }
    }

    private func deleteItems(offsets: IndexSet) {
        withAnimation {
            for index in offsets {
                modelContext.delete(items[index])
            }
        }
    }
}

fileprivate struct NavigationViewWrapper<Content: View>: View {
    let content: () -> Content
    var posts: [Post] = [post]

    var body: some View {
#if os(macOS)
        NavigationSplitView {
            content()
        } detail: {
//            Text("Select an item")
            List { ForEach(posts) { post in
                CardView(post: post)
            }
            }
        }
#else
        content()
#endif
    }
}

#Preview {
    ContentView()
        .modelContainer(for: Item.self, inMemory: true)
}
