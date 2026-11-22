//
//  Card.swift
//  HygerCard
//
//  Created by Christopher Boette on 11/21/26.
//

import SwiftUI
internal import System

struct CardView: View {
    let post: Post
    var body: some View {
        VStack(alignment: .leading) {
            Text(post.body)
                .font(.headline)
            Spacer()
            HStack {
                Label("by \(post.author[0])", systemImage: "person.3")
                Spacer()
                Label("from", systemImage: "clock")
            }
        }
    }
}

#Preview(traits: .fixedLayout(width: 400, height: 60)) {
    let b = Blyg(title: "My blyg", authors: ["a"], location: URL(filePath: "http://intertwingle.tm")!)
    let post = Post(parent: b, kind: Kind(rawValue: "thread")!, author: ["a"], body: "lorem ipsum", hasQuote: true)
    CardView(post: post)
}
